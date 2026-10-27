"""Mimadoz Cake cafe - kit version for 3D printing (separate parts).

Parts (each its own STL, already oriented for printing):
  v3_body.stl        base + floor + walls with door/window openings + sign
  v3_canopy.stl      mashrabiya portal canopy (prints upside down, flat top on the bed)
  v3_fence_*.stl     terrace fences, lying flat
Plus v3_assembled.stl (all parts in place, for preview only).

The base has slots: canopy legs and fence tabs drop into them.
Axes: x = left->right, y = front->back, z = up. Front faces -y.
"""
import numpy as np
import trimesh
from manifold3d import Manifold, CrossSection, FillRule, OpType
from matplotlib.textpath import TextPath
from matplotlib.font_manager import FontProperties

GROUND = 8.0          # top of plinth
FLOOR = 10.0          # top of building slab
TOP = 66.0            # wall top
WIN_Z0, WIN_Z1 = 18.0, 50.0   # window sill / head
DOOR_Z1 = 50.0
BX0, BY0, BX1, BY1 = 95, 70, 280, 250
T = 3.0
CZ0, CZ1 = 74.0, 79.0  # canopy frame bottom / top
SOCKET = 1.5           # depth of canopy leg sockets in the base
FIT = 0.25             # clearance per side for sockets and slots
FENCE_T = 1.6          # fence thickness
FENCE_H = 14.0         # fence height above the deck
TAB = 2.0              # fence tab depth into the base
DECK = GROUND + 1.0


def cube(x0, y0, z0, x1, y1, z1):
    return Manifold.cube([x1 - x0, y1 - y0, z1 - z0]).translate([x0, y0, z0])


def union(lst):
    return Manifold.batch_boolean(lst, OpType.Add)


def save(m, name):
    mesh = m.to_mesh()
    tm = trimesh.Trimesh(vertices=np.asarray(mesh.vert_properties)[:, :3], faces=np.asarray(mesh.tri_verts))
    tm.export(name)
    ext = tm.bounds[1] - tm.bounds[0]
    print(f"{name:24s} tris={len(tm.faces):6d} watertight={tm.is_watertight} size={ext.round(1).tolist()}")


def lattice(x0, y0, z0, x1, y1, z1, cell=5.0, hole=2.6, margin=3.0):
    """Mashrabiya panel. Thin axis = smallest extent; diamond holes go through it."""
    ext = [x1 - x0, y1 - y0, z1 - z0]
    thin = int(np.argmin(ext))
    a, b = [i for i in range(3) if i != thin]          # in-plane axes
    lo = [x0, y0, z0]
    holes = []
    nb = int((ext[b] - 2 * margin) // cell) + 1
    for j in range(nb):
        cb = lo[b] + margin + j * cell
        if cb > lo[b] + ext[b] - margin:
            break
        off = cell / 2 if j % 2 else 0
        k = 0
        while True:
            ca = lo[a] + margin + off + k * cell
            if ca > lo[a] + ext[a] - margin:
                break
            size = [hole, hole, hole]
            size[thin] = ext[thin] + 4
            h = Manifold.cube(size, center=True)
            rot = [0, 0, 0]
            rot[thin] = 45
            h = h.rotate(rot)
            c = [0, 0, 0]
            c[a], c[b] = ca, cb
            c[thin] = lo[thin] + ext[thin] / 2
            holes.append(h.translate(c))
            k += 1
    return cube(x0, y0, z0, x1, y1, z1) - union(holes)


# ============================ canopy (mashrabiya portal) ============================
legs = [  # footprints of everything that touches the base
    (80, 40, 95, 43), (80, 43, 83, 70),          # left column (front + side face)
    (280, 40, 295, 43), (292, 43, 295, 70),      # right column
    (80, BY1 - 6, 86, BY1), (289, BY1 - 6, 295, BY1),   # back posts
]
cp = []
z_leg0 = GROUND - SOCKET
cp.append(lattice(80, 40, z_leg0, 95, 43, CZ0))
cp.append(lattice(80, 43, z_leg0, 83, 70, CZ0))
cp.append(lattice(280, 40, z_leg0, 295, 43, CZ0))
cp.append(lattice(292, 43, z_leg0, 295, 70, CZ0))
cp.append(cube(80, BY1 - 6, z_leg0, 86, BY1, CZ0))
cp.append(cube(289, BY1 - 6, z_leg0, 295, BY1, CZ0))
cp.append(lattice(80, 40, CZ0 - 8, 295, 43, CZ1, cell=4.5, hole=2.2, margin=2.5))  # front fascia
cp.append(cube(80, 43, CZ0, 295, 48, CZ1))                     # front beam
cp.append(cube(80, 40, CZ0, 86, BY1, CZ1))                     # side beams
cp.append(cube(289, 40, CZ0, 295, BY1, CZ1))
cp.append(cube(80, BY1 - 6, CZ0, 295, BY1, CZ1))               # back beam
cp.append(cube(80, 70, CZ0, 295, 75, CZ1))                     # rear edge of shade
cp.append(lattice(86, 48, CZ1 - 2, 289, 70, CZ1, cell=5.0, hole=3.0, margin=2.5))  # mashrabiya shade roof
canopy = union(cp)

# ============================ fences ============================
def fence_piece(length):
    """Fence laid out along +x from 0, standing up: tab below z=0, fence above."""
    p = [cube(0, 0, -TAB, length, FENCE_T, 1.6)]                 # tab + bottom rail
    p.append(cube(0, 0, FENCE_H - 1.6, length, FENCE_T, FENCE_H))  # top rail
    p.append(cube(0, 0, 6.5, length, FENCE_T, 7.7))              # mid rail
    n = max(int(length // 4), 1)
    step = (length - FENCE_T) / n
    for i in range(n + 1):
        x = i * step
        p.append(cube(x, 0, 0, x + FENCE_T, FENCE_T, FENCE_H))
    return union(p)


fence_runs = {   # name: (start xy, direction, length)
    "front": ((15.2, 30.0 - FENCE_T / 2), "x", 60.8),
    "back": ((15.2, 255.0 - FENCE_T / 2), "x", 62.8),
    "left": ((16.0 - FENCE_T / 2, 30.0 + FENCE_T / 2 + 0.4), "y", 255.0 - 30.0 - FENCE_T - 0.8),
}
fence_parts = {}
fence_in_place = []
for name, ((sx, sy), d, L) in fence_runs.items():
    f = fence_piece(L)
    fence_parts[name] = f
    if d == "x":
        placed = f.translate([sx, sy, DECK])
    else:  # rotate so it runs along +y; thickness then sits on x
        placed = f.rotate([0, 0, 90]).translate([sx + FENCE_T, sy, DECK])
    fence_in_place.append(placed)

# ============================ body ============================
bp = []
bp.append(cube(0, 0, 0, 300, 300, 3))                  # wood board
bp.append(cube(4, 4, 3, 296, 296, GROUND))             # plinth
bp.append(cube(BX0, BY0, GROUND, BX1, BY1, FLOOR))     # building slab
bp.append(cube(12, 28, GROUND, 78, 258, DECK))         # terrace deck
bp.append(cube(150, 6, GROUND, 235, BY0, GROUND + 0.8))  # entrance paving
bp.append(cube(98, 30, GROUND, 278, BY0, GROUND + 0.8))  # front pavement
bp.append(cube(10, 8, GROUND, 140, 26, GROUND + 1.5))  # left planting bed (empty)
bp.append(cube(240, 8, GROUND, 292, 34, GROUND + 1.5)) # right planting bed (empty)

walls = [
    cube(BX0, BY0, FLOOR, BX1, BY0 + T, TOP),          # front
    cube(BX0, BY0, FLOOR, BX0 + T, BY1, TOP),          # left
    cube(BX1 - T, BY0, FLOOR, BX1, BY1, TOP),          # right
    cube(BX0, BY1 - T, FLOOR, BX1, BY1, TOP),          # back
    cube(125, 205, FLOOR, 128, BY1, TOP),              # kitchen side walls
    cube(218, 205, FLOOR, 221, BY1, TOP),
    cube(128, 205, FLOOR, 218, 208, TOP),              # kitchen front wall (serving hatch cut below)
    cube(221, 205, FLOOR, BX1, 208, TOP),              # washroom front wall
    cube(248, 208, FLOOR, 251, BY1, TOP),              # wall between washrooms
]
bp += walls

# sign
tp = TextPath((0, 0), "Mimadoz Cake", size=9, prop=FontProperties(family="DejaVu Serif"))
txt = Manifold.extrude(CrossSection([p for p in tp.to_polygons() if len(p) >= 3], FillRule.EvenOdd), 1.2)
bb = txt.bounding_box()
bp.append(txt.translate([-(bb[0] + bb[3]) / 2, 0, 0]).rotate([90, 0, 0]).translate([187, BY0 + 0.01, 54]))

body = union(bp)

cuts = [
    # front windows + door
    cube(102, BY0 - 1, WIN_Z0, 140, BY0 + T + 1, WIN_Z1),
    cube(146, BY0 - 1, WIN_Z0, 199, BY0 + T + 1, WIN_Z1),
    cube(205, BY0 - 1, FLOOR, 225, BY0 + T + 1, DOOR_Z1),
    cube(231, BY0 - 1, WIN_Z0, 273, BY0 + T + 1, WIN_Z1),
    # left wall windows + terrace door
    cube(BX0 - 1, 80, WIN_Z0, BX0 + T + 1, 120, WIN_Z1),
    cube(BX0 - 1, 128, WIN_Z0, BX0 + T + 1, 168, WIN_Z1),
    cube(BX0 - 1, 176, FLOOR, BX0 + T + 1, 192, DOOR_Z1),
    # right wall windows
    cube(BX1 - T - 1, 90, WIN_Z0, BX1 + 1, 130, WIN_Z1),
    cube(BX1 - T - 1, 140, WIN_Z0, BX1 + 1, 180, WIN_Z1),
    # kitchen: serving hatch + staff door
    cube(140, 204, FLOOR + 18, 200, 209, WIN_Z1),
    cube(204, 204, FLOOR, 216, 209, DOOR_Z1),
    # washroom doors
    cube(229, 204, FLOOR, 241, 209, DOOR_Z1),
    cube(257, 204, FLOOR, 269, 209, DOOR_Z1),
]
# sockets for canopy legs
for x0, y0, x1, y1 in legs:
    cuts.append(cube(x0 - FIT, y0 - FIT, GROUND - SOCKET, x1 + FIT, y1 + FIT, GROUND + 5))
# slots for fence tabs (cut down from the deck top)
for name, ((sx, sy), d, L) in fence_runs.items():
    if d == "x":
        cuts.append(cube(sx - FIT, sy - FIT, DECK - TAB - 0.2, sx + L + FIT, sy + FENCE_T + FIT, DECK + 1))
    else:
        cuts.append(cube(sx - FIT, sy - FIT, DECK - TAB - 0.2, sx + FENCE_T + FIT, sy + L + FIT, DECK + 1))
body = body - union(cuts)

# ============================ export ============================
save(body, "v3_body.stl")
# canopy upside down: flat top on the bed
c = canopy.rotate([180, 0, 0])
cb = c.bounding_box()
save(c.translate([-cb[0], -cb[1], -cb[2]]), "v3_canopy.stl")
for name, f in fence_parts.items():
    flat = f.rotate([90, 0, 0])               # lay it on its face
    fb = flat.bounding_box()
    save(flat.translate([-fb[0], -fb[1], -fb[2]]), f"v3_fence_{name}.stl")
save(union([body, canopy] + fence_in_place), "v3_assembled.stl")
