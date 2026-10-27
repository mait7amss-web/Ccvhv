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


# ---------- base ----------
box(0, 0, 0, 300, 300, 5)                      # plinth
box(BX0, BY0, 5, BX1, BY1, FLOOR)              # building floor slab
box(8, 55, 5, 66, 290, 6)                      # terrace paving
box(130, 5, 5, 160, BY0, 6)                    # entrance path

# ---------- building walls ----------
# front facade (glass shop front) x 70..228
fy0, fy1 = BY0, BY0 + T
box(BX0, fy0, FLOOR, 75, fy1, WALL_TOP)                 # left pier
box(75, fy0, FLOOR, 228, fy1, FLOOR + 2)                # sill
box(75, fy0, 47, 228, fy1, WALL_TOP)                    # sign band
for mx in (93, 111, 130, 150, 152, 170, 189, 208, 226):  # mullions / door frame
    box(mx - 0.8, fy0, FLOOR, mx + 0.8, fy1, 47)
box(131.5, fy0 + 0.6, FLOOR, 149.5, fy0 + 2.2, 47)      # wooden door panel
box(146, fy0 - 1.2, 22, 147.2, fy0 + 0.6, 34)           # door handle

# sign text "Mimadoz Cake" raised on the sign band
tp = TextPath((0, 0), "Mimadoz Cake", size=9, prop=FontProperties(family="DejaVu Serif"))
polys = [p for p in tp.to_polygons() if len(p) >= 3]
txt = Manifold.extrude(CrossSection(polys, FillRule.EvenOdd), 1.2)
bb = txt.bounding_box()
txt = txt.translate([-(bb[0] + bb[3]) / 2, 0, 0]).rotate([90, 0, 0])
parts.append(txt.translate([151, fy0 + 0.01, 53]))

# stone pillar + mashrabiya screen x 228..290
box(228, fy0 - 2, FLOOR - 2, 238, fy1, WALL_TOP)
screen = Manifold.cube([52, T, WALL_TOP - FLOOR]).translate([238, fy0, FLOOR])
holes = []
for i in range(9):
    for j in range(10):
        cx = 241.5 + i * 5.6 + (2.8 if j % 2 else 0)
        cz = FLOOR + 5 + j * 5.6
        if cx < 287:
            holes.append(Manifold.cube([3, 10, 3], center=True).rotate([0, 45, 0]).translate([cx, fy0 + 1.5, cz]))
parts.append(screen - Manifold.batch_boolean(holes, OpType.Add))

# side and back walls
box(BX0, BY0, FLOOR, BX0 + T, BY1, WALL_TOP)            # left wall
box(BX1 - T, BY0, FLOOR, BX1, BY1, WALL_TOP)            # right wall
box(BX0, BY1 - T, FLOOR, BX1, BY1, WALL_TOP)            # back wall

# interior partitions
box(125, 238, FLOOR, 128, BY1, 52)                       # wall between majlis & kitchen
box(212, 228, FLOOR, 215, BY1 - 15, WALL_TOP)            # washroom block wall (opening at back)
box(212, 228, FLOOR, 232, 231, WALL_TOP)
box(246, 228, FLOOR, BX1, 231, WALL_TOP)                 # door gap 232..246
box(250, 231, FLOOR, 253, BY1, WALL_TOP)                 # wall between two washrooms
box(232, 228, 47, 246, 231, WALL_TOP)                    # lintel

# ---------- back-left majlis ----------
sofa_x(80, 124, BY1 - T, 10, -1)
sofa_y(232, 272, BX0 + T, 10, 1)
box(88, 238, FLOOR, 120, 266, FLOOR + 0.6)               # rug
cyl(104, 252, FLOOR, 6, 6)                               # coffee table
for i in range(5):                                       # cushions
    box(86 + i * 7, BY1 - T - 9, FLOOR + 7, 91 + i * 7, BY1 - T - 6, FLOOR + 11)
tree(120, 277, FLOOR, 18, 6)

# ---------- kitchen & display ----------
box(132, BY1 - T - 12, FLOOR, 208, BY1 - T, FLOOR + 18)  # back counter
box(132, BY1 - T - 4, FLOOR + 32, 208, BY1 - T, FLOOR + 44)   # upper cabinets
box(145, BY1 - T - 9, FLOOR + 18, 158, BY1 - T - 2, FLOOR + 28)  # espresso machine
box(175, BY1 - T - 9, FLOOR + 18, 188, BY1 - T - 2, FLOOR + 26)  # oven
box(138, 232, FLOOR, 202, 246, FLOOR + 17)              # display counter
box(140, 233, FLOOR + 17, 200, 245, FLOOR + 18)         # glass top frame
for gx in (160, 180):
    box(gx - 0.5, 233, FLOOR + 17, gx + 0.5, 245, FLOOR + 25)
box(140, 233, FLOOR + 25, 200, 245, FLOOR + 26)
plant(133, 240, FLOOR, 2.5, 5, 4)
box(203, 205, FLOOR, 211, 224, FLOOR + 38)              # cake fridge
plant(206, 198, FLOOR, 2.5, 5, 3.5)

# washroom fixtures
box(225, BY1 - T - 10, FLOOR, 233, BY1 - T, FLOOR + 10)
box(265, BY1 - T - 10, FLOOR, 273, BY1 - T, FLOOR + 10)

# ---------- right majlis ----------
sofa_y(110, 200, BX1 - T, 10, -1)
sofa_x(236, 277, 110, 10, 1)
box(242, 124, FLOOR, 272, 192, FLOOR + 0.6)
cyl(257, 158, FLOOR, 6, 6)
for i in range(6):
    box(BX1 - T - 9, 120 + i * 12, FLOOR + 7, BX1 - T - 6, 126 + i * 12, FLOOR + 11)
plant(280, 215, FLOOR, 3, 7, 4)

# ---------- central raised booth with planter screens ----------
box(120, 95, FLOOR, 192, 152, FLOOR + 2)
for x0, y0, x1, y1 in ((120, 95, 192, 97), (120, 150, 150, 152), (162, 150, 192, 152),
                       (120, 95, 122, 152), (190, 95, 192, 152)):
    box(x0, y0, FLOOR + 2, x1, y1, FLOOR + 12)
for px in range(126, 190, 8):
    ball(px, 96, FLOOR + 13, 2.2, 10)
square_table(142, 123, 18, 14, FLOOR + 2, chairs=((0, -1), (0, 1), (-1, 0)))
square_table(170, 123, 18, 14, FLOOR + 2, chairs=((0, -1), (0, 1), (1, 0)))

# ---------- dining tables ----------
for x, y in ((100, 195), (150, 205), (195, 175), (215, 95), (240, 210)):
    round_table(x, y)
square_table(95, 150, 14, 14)
square_table(95, 100, 14, 14)
plant(80, 70, FLOOR, 3, 7, 5)
tree(80, 225, FLOOR, 16, 6)
box(78, 160, FLOOR, 84, 175, FLOOR + 10)                 # side cabinet

# ---------- left terrace ----------
for y in (85, 130, 175, 220, 262):
    round_table(37, y, z=6, r=7, chairs=4)
fence(14, 55, 14, 290, 6)
fence(14, 55, 66, 55, 6)
shrub_row(9, 60, 9, 288, 5, 30, 3.2)
tree(22, 280, 6, 22, 8)
plant(60, 70, 6, 3, 6, 4.5)
plant(60, 240, 6, 3, 6, 4.5)

# ---------- front gardens ----------
box(72, 10, 5, 128, 34, 7)                               # left bed
fence(72, 36, 128, 36, 5, 10)
shrub_row(76, 22, 124, 22, 7, 9, 3.5)
plant(140, 48, 6, 3.5, 8, 5)                              # pot by the door
box(165, 10, 5, 296, 52, 7)                              # right bed
shrub_row(170, 45, 290, 45, 7, 18, 3.2)
shrub_row(175, 15, 290, 15, 7, 14, 3)
tree(270, 30, 7, 28, 10)
fence(165, 54, 225, 54, 7, 10)
round_table(200, 28, z=7, r=6, chairs=2)

# ---------- assemble ----------
model = Manifold.batch_boolean(parts, OpType.Add)
# terrace door in the left wall
model = model - Manifold.cube([T + 2, 22, 40]).translate([BX0 - 1, 95, FLOOR])

mesh = model.to_mesh()
tm = trimesh.Trimesh(vertices=np.asarray(mesh.vert_properties)[:, :3], faces=np.asarray(mesh.tri_verts))
tm.export("cafe_mimadoz_300mm.stl")
print("triangles:", len(tm.faces), "watertight:", tm.is_watertight, "bounds:", tm.bounds.tolist())
