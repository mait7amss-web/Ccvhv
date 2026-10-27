"""Builds a 300x300 mm cafe model (Mimadoz Cake style) and writes a printable STL.

Axes: x = left->right, y = front->back, z = up. Front facade faces -y.
Run: python3 build_cafe.py  -> cafe_mimadoz_300mm.stl
"""
import math
import numpy as np
import trimesh
from manifold3d import Manifold, CrossSection, FillRule, OpType
from matplotlib.textpath import TextPath
from matplotlib.font_manager import FontProperties

parts = []


def box(x0, y0, z0, x1, y1, z1):
    parts.append(Manifold.cube([x1 - x0, y1 - y0, z1 - z0]).translate([x0, y0, z0]))


def cyl(x, y, z0, h, r, seg=24):
    parts.append(Manifold.cylinder(h, r, r, seg).translate([x, y, z0]))


def ball(x, y, z, r, seg=16):
    parts.append(Manifold.sphere(r, seg).translate([x, y, z]))


FLOOR = 7.0          # top of building floor slab
WALL_TOP = 67.0      # wall height 60 mm above floor
T = 3.0              # wall thickness
BX0, BY0, BX1, BY1 = 70, 60, 290, 285   # building footprint


# ---------- furniture helpers ----------
def chair(x, y, face_deg, z=FLOOR):
    """Chair centred at (x, y); backrest on the side opposite face_deg."""
    seat = Manifold.cube([6, 6, 6]).translate([-3, -3, 0])
    back = Manifold.cube([6, 1.5, 13]).translate([-3, -4.5, 0])
    c = (seat + back).rotate([0, 0, face_deg - 90]).translate([x, y, z])
    parts.append(c)


def round_table(x, y, z=FLOOR, r=7, chairs=4, lamp=True):
    cyl(x, y, z, 1, 4)
    cyl(x, y, z, 12, 1.2, 12)
    cyl(x, y, z + 11, 1.5, r)
    if lamp:
        cyl(x, y, z + 12.5, 2, 1.2, 12)
    for i in range(chairs):
        a = math.radians(45 + i * 360 / chairs)
        d = r + 4
        chair(x + d * math.cos(a), y + d * math.sin(a), math.degrees(a) + 180, z)


def square_table(x, y, w=14, d=14, z=FLOOR, chairs=((0, -1), (0, 1))):
    box(x - w / 2, y - d / 2, z + 10.5, x + w / 2, y + d / 2, z + 12)
    box(x - 1.2, y - 1.2, z, x + 1.2, y + 1.2, z + 10.5)
    box(x - 4, y - 4, z, x + 4, y + 4, z + 1)
    cyl(x, y, z + 12, 2, 1.2, 12)
    for cx, cy in chairs:
        px = x + cx * (w / 2 + 4)
        py = y + cy * (d / 2 + 4)
        chair(px, py, math.degrees(math.atan2(-cy, -cx)), z)


def plant(x, y, z=FLOOR, pot_r=3, h=6, leaf_r=5):
    cyl(x, y, z, h, pot_r, 16)
    ball(x, y, z + h + leaf_r * 0.8, leaf_r)


def tree(x, y, z, trunk_h=25, crown=9):
    cyl(x, y, z, trunk_h, 1.5, 12)
    ball(x, y, z + trunk_h, crown)
    ball(x + crown * 0.6, y, z + trunk_h - 3, crown * 0.7)
    ball(x - crown * 0.5, y + 2, z + trunk_h - 4, crown * 0.65)


def shrub_row(x0, y0, x1, y1, z, n, r=3.5):
    for i in range(n):
        t = i / max(n - 1, 1)
        ball(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z + r * 0.6, r * (0.8 + 0.4 * ((i * 7) % 3) / 2))


def fence(x0, y0, x1, y1, z, h=12, step=6):
    L = math.hypot(x1 - x0, y1 - y0)
    n = int(L // step) + 1
    for i in range(n + 1):
        t = min(i * step / L, 1)
        x, y = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
        box(x - 0.6, y - 0.6, z, x + 0.6, y + 0.6, z + h)
    for zz in (z + 2, z + h - 1.2):
        if x0 == x1:
            box(x0 - 0.6, min(y0, y1), zz, x0 + 0.6, max(y0, y1), zz + 1.2)
        else:
            box(min(x0, x1), y0 - 0.6, zz, max(x0, x1), y0 + 0.6, zz + 1.2)


def sofa_x(x0, x1, y_wall, depth, toward):  # sofa along a wall parallel to x
    ys = sorted([y_wall, y_wall + toward * depth])
    box(x0, ys[0], FLOOR, x1, ys[1], FLOOR + 7)
    yb = sorted([y_wall, y_wall + toward * 3])
    box(x0, yb[0], FLOOR, x1, yb[1], FLOOR + 15)


def sofa_y(y0, y1, x_wall, depth, toward):  # sofa along a wall parallel to y
    xs = sorted([x_wall, x_wall + toward * depth])
    box(xs[0], y0, FLOOR, xs[1], y1, FLOOR + 7)
    xb = sorted([x_wall, x_wall + toward * 3])
    box(xb[0], y0, FLOOR, xb[1], y1, FLOOR + 15)


# ======================= V2 layout (portal + canopy) =======================
GROUND = 8.0
FLOOR = 10.0
TOP = 66.0                       # wall top
BX0, BY0, BX1, BY1 = 95, 70, 280, 250


def mashrabiya(x0, y0, x1, y1, z0, z1, cell=5.0, hole=2.6):
    """Perforated panel; thin along x or y."""
    pnl = Manifold.cube([x1 - x0, y1 - y0, z1 - z0]).translate([x0, y0, z0])
    along_x = (x1 - x0) >= (y1 - y0)
    L = (x1 - x0) if along_x else (y1 - y0)
    holes = []
    nj = int((z1 - z0 - 4) // cell)
    for j in range(nj):
        cz = z0 + 4 + j * cell
        off = cell / 2 if j % 2 else 0
        k = 0
        while True:
            c = 3 + off + k * cell
            if c > L - 3:
                break
            h = Manifold.cube([hole, hole, hole], center=True)
            h = Manifold.cube([hole, 20, hole], center=True).rotate([0, 45, 0]) if along_x else \
                Manifold.cube([20, hole, hole], center=True).rotate([45, 0, 0])
            holes.append(h.translate([x0 + c, (y0 + y1) / 2, cz] if along_x else [(x0 + x1) / 2, y0 + c, cz]))
            k += 1
    parts.append(pnl - Manifold.batch_boolean(holes, OpType.Add))


# ---------- base: wood board + white plinth ----------
box(0, 0, 0, 300, 300, 3)
box(4, 4, 3, 296, 296, GROUND)
box(BX0, BY0, GROUND, BX1, BY1, FLOOR)                  # building slab
box(14, 30, GROUND, 92, 255, GROUND + 1)                # terrace deck
box(150, 6, GROUND, 235, BY0, GROUND + 0.8)             # entrance paving

# ---------- front glass facade ----------
fy0, fy1 = BY0, BY0 + 3
box(BX0, fy0, FLOOR, BX1, fy1, FLOOR + 2)               # sill
box(BX0, fy0, 50, BX1, fy1, TOP)                        # sign band
box(BX0, fy0, FLOOR, BX0 + 4, fy1, 50)
box(BX1 - 4, fy0, FLOOR, BX1, fy1, 50)
for mx in (122, 148, 174, 200, 204, 226, 230, 253):
    box(mx - 0.8, fy0, FLOOR, mx + 0.8, fy1, 50)
box(205, fy0 + 0.5, FLOOR, 225, fy0 + 2.5, 50)          # wooden door
box(208, fy0 - 1.2, 20, 209.2, fy0 + 0.5, 40)           # long pull handle

tp = TextPath((0, 0), "Mimadoz Cake", size=9, prop=FontProperties(family="DejaVu Serif"))
txt = Manifold.extrude(CrossSection([p for p in tp.to_polygons() if len(p) >= 3], FillRule.EvenOdd), 1.2)
bb = txt.bounding_box()
parts.append(txt.translate([-(bb[0] + bb[3]) / 2, 0, 0]).rotate([90, 0, 0]).translate([187, fy0 + 0.01, 54]))

# ---------- side, back walls ----------
lx0, lx1 = BX0, BX0 + 3                                   # left wall: glass towards terrace
box(lx0, BY0, FLOOR, lx1, BY1, FLOOR + 2)
box(lx0, BY0, 50, lx1, BY1, TOP)
for my in (BY0 + 1.5, 100, 125, 150, 172, 192, 215, BY1 - 1.5):
    box(lx0, my - 1.5 if my in (BY0 + 1.5, BY1 - 1.5) else my - 0.8, FLOOR, lx1,
        my + 1.5 if my in (BY0 + 1.5, BY1 - 1.5) else my + 0.8, 50)
box(lx0, 215, FLOOR, lx1, BY1, 50)                        # solid part behind kitchen
box(BX1 - 3, BY0, FLOOR, BX1, BY1, TOP)                   # right wall
box(BX0, BY1 - 3, FLOOR, BX1, BY1, TOP)                   # back wall

# ---------- kitchen block ----------
box(125, 205, FLOOR, 128, BY1, TOP)                       # kitchen side walls
box(218, 205, FLOOR, 221, BY1, TOP)
box(132, BY1 - 15, FLOOR, 215, BY1 - 3, FLOOR + 18)       # back counter
box(132, BY1 - 7, FLOOR + 32, 215, BY1 - 3, FLOOR + 44)   # wall cabinets
box(140, BY1 - 12, FLOOR + 18, 152, BY1 - 5, FLOOR + 28)  # espresso machine
box(160, BY1 - 11, FLOOR + 18, 166, BY1 - 5, FLOOR + 24)  # grinder
box(185, BY1 - 12, FLOOR + 18, 200, BY1 - 5, FLOOR + 27)  # oven
box(128, 196, FLOOR, 208, 207, FLOOR + 17)                # display / service counter
box(130, 197, FLOOR + 17, 206, 206, FLOOR + 18)
for gx in (155, 181):
    box(gx - 0.5, 197, FLOOR + 17, gx + 0.5, 206, FLOOR + 25)
box(130, 197, FLOOR + 25, 206, 206, FLOOR + 26)           # glass case top
box(110, 208, FLOOR, 124, 246, FLOOR + 30)                # back-left shelving
for z in (FLOOR + 10, FLOOR + 20):
    box(109, 209, z, 110, 245, z + 1)

# ---------- washrooms (back right) ----------
box(221, 205, FLOOR, 228, 208, TOP)
box(240, 205, FLOOR, 254, 208, TOP)
box(266, 205, FLOOR, BX1, 208, TOP)
box(228, 205, 50, 240, 208, TOP)
box(254, 205, 50, 266, 208, TOP)
box(248, 208, FLOOR, 251, BY1, TOP)
box(234, BY1 - 12, FLOOR, 242, BY1 - 3, FLOOR + 9)
box(262, BY1 - 12, FLOOR, 270, BY1 - 3, FLOOR + 9)

# ---------- lounge with fireplace (right side) ----------
fp = Manifold.cube([7, 20, 42]).translate([BX1 - 10, 140, FLOOR])
fp = fp - Manifold.cube([4, 12, 10]).translate([BX1 - 11, 144, FLOOR + 3])
parts.append(fp)
box(BX1 - 8, 141, FLOOR + 42, BX1 - 3, 159, TOP)         # chimney breast
sofa_y(130, 170, 243, 9, 1)                               # sofa facing the fireplace
for yy in (120, 176):
    box(250, yy - 4, FLOOR, 258, yy + 4, FLOOR + 6)       # armchairs
    box(250, yy - 4 if yy < 150 else yy + 2.5, FLOOR, 258, yy - 2.5 if yy < 150 else yy + 4, FLOOR + 12)
box(254, 128, FLOOR, 270, 172, FLOOR + 0.6)               # rug
cyl(262, 150, FLOOR, 5, 4.5)
plant(272, 186, FLOOR, 2.5, 6, 4)
plant(272, 80, FLOOR, 3, 7, 5)

# ---------- dining ----------
for x in (128, 170, 212):
    round_table(x, 108)
    round_table(x, 160)
box(150, 130, FLOOR, 192, 140, FLOOR + 0.6)               # runner rug
sofa_y(102, 168, BX0 + 3, 7, 1)                           # banquette along the glass
plant(104, 83, FLOOR, 2.5, 6, 4)
plant(104, 196, FLOOR, 2.5, 6, 4)

# ---------- portal: mashrabiya columns + canopy ----------
CZ0, CZ1 = 74, 79
mashrabiya(80, 40, 95, 43, GROUND, CZ0)                   # left column (front face)
mashrabiya(80, 43, 83, 70, GROUND, CZ0)                   # left column (side face)
mashrabiya(280, 40, 295, 43, GROUND, CZ0)                 # right column (front face)
mashrabiya(292, 43, 295, 70, GROUND, CZ0)                 # right column (side face)
box(80, 40, CZ0, 295, 48, CZ1)                            # front beam
box(80, 40, CZ0, 86, BY1, CZ1)                            # side beams
box(289, 40, CZ0, 295, BY1, CZ1)
box(80, BY1 - 6, CZ0, 295, BY1, CZ1)                      # back beam
for px, py in ((80, BY1 - 6), (289, BY1 - 6)):            # back posts
    box(px, py, GROUND, px + 6, py + 6, CZ0)
box(86, 66, 64, 289, 70, CZ0)                             # header resting on facade
box(BX0, BY1 - 4, TOP, BX1, BY1, CZ0)                     # back header

# ---------- terrace ----------
for i, y in enumerate((65, 110, 155, 200)):
    round_table(34, y + (0 if True else 0), z=GROUND + 1)
    round_table(68, y + 22, z=GROUND + 1)
fence(16, 30, 16, 255, GROUND + 1)
fence(16, 30, 76, 30, GROUND + 1)
fence(16, 255, 92, 255, GROUND + 1)
shrub_row(9, 34, 9, 290, GROUND, 28, 3)
box(8, 258, GROUND, 95, 292, GROUND + 1.5)                # back planting bed
tree(26, 272, GROUND + 1.5, 24, 9)
shrub_row(45, 275, 90, 275, GROUND + 1.5, 7, 4)
tree(70, 45, GROUND + 1, 22, 8)

# ---------- front gardens ----------
box(10, 8, GROUND, 140, 26, GROUND + 1.5)                 # left grass bed
shrub_row(15, 17, 135, 17, GROUND + 1.5, 16, 3.6)
box(240, 8, GROUND, 292, 34, GROUND + 1.5)                # right grass bed
shrub_row(245, 16, 288, 16, GROUND + 1.5, 7, 3.6)
shrub_row(250, 27, 285, 27, GROUND + 1.5, 6, 3)
plant(138, 60, GROUND, 4, 9, 6)                           # potted olive trees
plant(236, 60, GROUND, 4, 9, 6)
box(BX0, 30, GROUND, BX1, 70, GROUND + 0.8)               # front pavement

# ---------- assemble ----------
model = Manifold.batch_boolean(parts, OpType.Add)
model = model - Manifold.cube([5, 16, 38]).translate([BX0 - 1, 175, FLOOR])   # terrace door
mesh = model.to_mesh()
tm = trimesh.Trimesh(vertices=np.asarray(mesh.vert_properties)[:, :3], faces=np.asarray(mesh.tri_verts))
tm.export("cafe_mimadoz_v2_300mm.stl")
print("triangles:", len(tm.faces), "watertight:", tm.is_watertight, "bounds:", tm.bounds.tolist())
