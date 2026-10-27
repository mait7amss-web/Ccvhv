"""Writes cafe_preview.html: one self-contained 3D viewer of the assembled v3 kit."""
import base64, io, sys, numpy as np, trimesh
sys.argv = sys.argv[:1]
import build_cafe_v3 as k

T128 = sys.path and __import__("os").environ["T128"]

def b64(m):
    mesh = m.to_mesh()
    tm = trimesh.Trimesh(np.asarray(mesh.vert_properties)[:, :3], np.asarray(mesh.tri_verts))
    return base64.b64encode(tm.export(file_type="stl")).decode()

parts = {"body": b64(k.body), "canopy": b64(k.canopy), "fences": b64(k.union(k.fence_in_place))}
js = "".join(open(f"{T128}/{p}").read() + "\n" for p in
             ("build/three.min.js", "examples/js/controls/OrbitControls.js", "examples/js/loaders/STLLoader.js"))
html = open("preview_template.html").read()
html = html.replace("/*THREE*/", js).replace("/*DATA*/", "const DATA=" + __import__("json").dumps(parts) + ";")
html = html.replace("/*GALLERY*/", "const GALLERY=" + open(__import__("os").environ["GAL"]).read() + ";")
open("cafe_preview.html", "w").write(html)
print("size MB", round(len(html) / 1e6, 2))
