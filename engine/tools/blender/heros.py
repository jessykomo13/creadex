# Personnage « Héros » pour CréaEngine : modélisé, riggé et animé par script dans Blender 4.2
# blender -b -P heros.py -- sortie.glb
# Repère Blender : Z en haut, le perso regarde +Y (devient -Z dans le jeu), sa droite est +X.

import bpy, bmesh, math, random, sys
from mathutils import Vector, Matrix, Euler, Quaternion

OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else '/tmp/heros.glb'
random.seed(7)

# ---------------------------------------------------------------- scène vide
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30

# ---------------------------------------------------------------- matériaux
def mat(name, color, rough=0.6, metal=0.0, emit=None, strength=0.0, double=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    c = tuple(int(color[i:i + 2], 16) / 255 for i in (1, 3, 5))
    # couleurs données en sRGB → linéaire pour Blender
    lin = tuple((x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)
    b.inputs['Base Color'].default_value = (*lin, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        e = tuple(int(emit[i:i + 2], 16) / 255 for i in (1, 3, 5))
        b.inputs['Emission Color'].default_value = (*e, 1)
        b.inputs['Emission Strength'].default_value = strength
    m.use_backface_culling = not double
    return m

MATS = {
    'peau': mat('Peau', '#f6c39a', 0.65),
    'cheveux': mat('Cheveux', '#23203a', 0.45, double=True),
    'sweat': mat('Sweat', '#ff5a36', 0.7),
    'sweat2': mat('SweatFonce', '#d63f22', 0.75),
    'blanc': mat('Blanc', '#f4f4f6', 0.45),
    'jean': mat('Pantalon', '#27324a', 0.8),
    'jean2': mat('PantalonFonce', '#1b2336', 0.85),
    'semelle': mat('Semelle', '#22d3c5', 0.5),
    'noir': mat('Noir', '#16161c', 0.35, 0.2),
    'oeil': mat('BlancOeil', '#ffffff', 0.25),
    'iris': mat('Iris', '#2f8bff', 0.3),
    'pupille': mat('Pupille', '#0b0b14', 0.2),
    'reflet': mat('Reflet', '#ffffff', 0.1, emit='#ffffff', strength=1.5),
    'joue': mat('Joues', '#ff8fa3', 0.7),
    'bouche': mat('Bouche', '#5a1e2a', 0.5),
    'neon': mat('Neon', '#22d3c5', 0.3, emit='#22d3c5', strength=1.2),
}
MAT_ORDER = list(MATS.keys())

# ---------------------------------------------------------------- os (positions de repos)
BONES = {
    'racine': ((0, 0, 0), (0, 0, 0.15), None),
    'hanches': ((0, 0, 0.66), (0, 0, 0.78), 'racine'),
    'dos': ((0, 0, 0.78), (0, 0, 0.92), 'hanches'),
    'torse': ((0, 0, 0.92), (0, 0, 1.06), 'dos'),
    'cou': ((0, 0, 1.06), (0, 0, 1.13), 'torse'),
    'tete': ((0, 0, 1.13), (0, 0, 1.45), 'cou'),
    'yeux': ((0, 0.15, 1.30), (0, 0.22, 1.30), 'tete'),
}
for side, s in (('G', -1), ('D', 1)):
    BONES['bras.' + side] = ((0.19 * s, 0, 1.0), (0.265 * s, 0, 0.81), 'torse')
    BONES['avantbras.' + side] = ((0.265 * s, 0, 0.81), (0.31 * s, 0, 0.64), 'bras.' + side)
    BONES['main.' + side] = ((0.31 * s, 0, 0.64), (0.325 * s, 0, 0.55), 'avantbras.' + side)
    BONES['cuisse.' + side] = ((0.095 * s, 0, 0.64), (0.1 * s, 0, 0.36), 'hanches')
    BONES['tibia.' + side] = ((0.1 * s, 0, 0.36), (0.1 * s, 0, 0.11), 'cuisse.' + side)
    BONES['pied.' + side] = ((0.1 * s, 0, 0.11), (0.1 * s, 0.15, 0.04), 'tibia.' + side)
BONE_ORDER = list(BONES.keys())

def seg_dist(p, a, b):
    a, b = Vector(a), Vector(b)
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(1e-9, ab.dot(ab))))
    return (a + ab * t - p).length

# ---------------------------------------------------------------- géométrie (un seul bmesh)
bm = bmesh.new()
deform = bm.verts.layers.deform.verify()

def finish(verts, material, weights, smooth=True):
    """material : clé de MATS ; weights : nom d'os, ou liste d'os pour un mélange par distance"""
    vs = set(verts)
    faces = {f for v in vs for f in v.link_faces}
    mi = MAT_ORDER.index(material)
    for f in faces:
        f.material_index = mi
        f.smooth = smooth
    for v in vs:
        d = v[deform]
        if isinstance(weights, str):
            d[BONE_ORDER.index(weights)] = 1.0
        else:
            ws = []
            for bn in weights:
                h, t, _ = BONES[bn]
                ws.append((bn, 1.0 / (seg_dist(v.co, h, t) + 0.012) ** 4))
            ws.sort(key=lambda x: -x[1])
            ws = ws[:3]
            tot = sum(w for _, w in ws)
            for bn, w in ws:
                if w / tot > 0.02:
                    d[BONE_ORDER.index(bn)] = w / tot

def xform(verts, center=(0, 0, 0), size=(1, 1, 1), rot=(0, 0, 0)):
    m = Matrix.Translation(Vector(center)) @ Euler([math.radians(r) for r in rot], 'XYZ').to_matrix().to_4x4() @ Matrix.Diagonal((*size, 1))
    for v in verts:
        v.co = m @ v.co

def blob(center, size, material, weights, rot=(0, 0, 0), u=20, v=14, power=1.0, keep=None):
    """Ellipsoïde (power < 1 = plus carré, façon jouet)"""
    big = max(size)
    k = 0.8 if big > 0.1 else 0.62 if big > 0.04 else 0.5
    u, v = max(8, round(u * k)), max(5, round(v * k))
    r = bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=1.0)
    verts = r['verts']
    if power != 1.0:
        for vt in verts:
            vt.co = Vector([math.copysign(abs(c) ** power, c) for c in vt.co])
            if vt.co.length > 0:
                pass
    xform(verts, center, size, rot)
    if keep:
        dead = [vt for vt in verts if not keep(vt.co)]
        bmesh.ops.delete(bm, geom=dead, context='VERTS')
        verts = [vt for vt in verts if vt.is_valid]
    finish(verts, material, weights)
    return verts

def tube(points, radii, material, weights, segs=14, caps=True):
    """Tube le long d'une ligne brisée, rayon interpolé"""
    pts = [Vector(p) for p in points]
    segs = max(6, round(segs * 0.8))
    rings = []
    up = Vector((0, 1, 0))
    for i, p in enumerate(pts):
        d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        a = up if abs(d.dot(up)) < 0.9 else Vector((1, 0, 0))
        x = d.cross(a).normalized()
        y = d.cross(x).normalized()
        ring = []
        for k in range(segs):
            t = 2 * math.pi * k / segs
            ring.append(bm.verts.new(p + (x * math.cos(t) + y * math.sin(t)) * radii[i]))
        rings.append(ring)
    allv = [v for r in rings for v in r]
    for i in range(len(rings) - 1):
        for k in range(segs):
            a, b = rings[i][k], rings[i][(k + 1) % segs]
            c, d = rings[i + 1][(k + 1) % segs], rings[i + 1][k]
            bm.faces.new((a, b, c, d))
    if caps:
        for ring, rev in ((rings[0], True), (rings[-1], False)):
            ctr = sum((v.co for v in ring), Vector()) / len(ring)
            cv = bm.verts.new(ctr)
            allv.append(cv)
            for k in range(segs):
                a, b = ring[k], ring[(k + 1) % segs]
                bm.faces.new((cv, b, a) if rev else (cv, a, b))
    finish(allv, material, weights)
    return allv

def limb(a, b, r0, r1, material, weights, n=8, rmid=None):
    a, b = Vector(a), Vector(b)
    pts, rad = [], []
    for i in range(n + 1):
        t = i / n
        pts.append(a.lerp(b, t))
        r = r0 + (r1 - r0) * t
        if rmid is not None:
            r += (rmid - (r0 + r1) / 2) * math.sin(math.pi * t)
        rad.append(r)
    return tube(pts, rad, material, weights)

def torus(center, R, r, material, weights, rot=(0, 0, 0), scale=(1, 1, 1), segs=24, rsegs=8, arc=None):
    segs, rsegs = max(10, round(segs * 0.7)), max(5, rsegs - 2)
    rings = []
    n = segs if arc is None else segs + 1
    for i in range(n):
        a = (2 * math.pi * i / segs) if arc is None else (arc[0] + (arc[1] - arc[0]) * i / segs)
        c = Vector((math.cos(a) * R, math.sin(a) * R, 0))
        out = Vector((math.cos(a), math.sin(a), 0))
        ring = []
        for k in range(rsegs):
            t = 2 * math.pi * k / rsegs
            ring.append(bm.verts.new(c + out * (math.cos(t) * r) + Vector((0, 0, math.sin(t) * r))))
        rings.append(ring)
    allv = [v for rr in rings for v in rr]
    m = len(rings) if arc is None else len(rings) - 1
    for i in range(m):
        r1, r2 = rings[i], rings[(i + 1) % len(rings)]
        for k in range(rsegs):
            bm.faces.new((r1[k], r1[(k + 1) % rsegs], r2[(k + 1) % rsegs], r2[k]))
    xform(allv, center, scale, rot)
    finish(allv, material, weights)
    return allv

def cone(base, direction, radius, length, material, weights, segs=10):
    d = Vector(direction).normalized()
    r = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=True, segments=segs, radius1=radius, radius2=0.0, depth=length)
    verts = r['verts']
    q = Vector((0, 0, 1)).rotation_difference(d)
    m = Matrix.Translation(Vector(base) + d * (length / 2)) @ q.to_matrix().to_4x4()
    for v in verts:
        v.co = m @ v.co
    finish(verts, material, weights)
    return verts

TORSO = ['hanches', 'dos', 'torse']

# --- tête
blob((0, 0.005, 1.30), (0.175, 0.165, 0.18), 'peau', 'tete', u=28, v=20)
blob((0, 0.055, 1.205), (0.12, 0.105, 0.08), 'peau', 'tete', u=20, v=12)
for s in (-1, 1):
    blob((0.171 * s, -0.005, 1.29), (0.028, 0.02, 0.042), 'peau', 'tete', u=12, v=8)
blob((0, 0.168, 1.255), (0.02, 0.016, 0.015), 'peau', 'tete', u=12, v=8)
# yeux (os « yeux » : le clignement écrase cet os)
for s in (-1, 1):
    x = 0.07 * s
    blob((x, 0.148, 1.30), (0.05, 0.026, 0.066), 'oeil', 'yeux', u=18, v=12)
    blob((x + 0.004 * s, 0.163, 1.293), (0.036, 0.016, 0.049), 'iris', 'yeux', u=16, v=10)
    blob((x + 0.004 * s, 0.172, 1.29), (0.02, 0.01, 0.028), 'pupille', 'yeux', u=12, v=8)
    blob((x + 0.018 * s, 0.181, 1.312), (0.012, 0.006, 0.013), 'reflet', 'yeux', u=8, v=6)
    blob((x - 0.012 * s, 0.181, 1.276), (0.006, 0.004, 0.006), 'reflet', 'yeux', u=6, v=4)
    # sourcils
    blob((0.077 * s, 0.138, 1.392), (0.042, 0.014, 0.012), 'cheveux', 'tete', rot=(0, -14 * s, 0), u=10, v=6)
    # joues
    blob((0.112 * s, 0.112, 1.232), (0.032, 0.012, 0.019), 'joue', 'tete', rot=(0, 0, -38 * s), u=12, v=8)
# sourire
smile = [(x, 0.166 - 1.4 * x * x, 1.207 + 5.5 * x * x) for x in [(-0.042 + 0.084 * i / 10) for i in range(11)]]
tube(smile, [0.0065] * len(smile), 'bouche', 'tete', segs=8)

# --- cheveux : calotte + mèches en pointes
def hairline(co):
    rel = co.z - 1.32
    if co.y > 0.08:
        return rel > 0.075 - 0.25 * abs(co.x)
    if co.y > -0.04:
        return rel > -0.02
    return rel > -0.15
blob((0, -0.008, 1.322), (0.188, 0.182, 0.198), 'cheveux', 'tete', u=28, v=20, keep=hairline)

def on_cap(theta, phi):
    # theta : autour (0 = devant +Y), phi : depuis le haut
    x = math.sin(phi) * math.sin(theta) * 0.18
    y = math.sin(phi) * math.cos(theta) * 0.175 - 0.008
    z = math.cos(phi) * 0.19 + 1.322
    n = Vector((x / 0.18, (y + 0.008) / 0.175, (z - 1.322) / 0.19)).normalized()
    return Vector((x, y, z)), n

spikes = [
    # (theta°, phi°, longueur, rayon, inclinaison vers l'arrière)
    (0, 38, 0.15, 0.055, -0.15), (-28, 42, 0.14, 0.05, -0.1), (28, 42, 0.14, 0.05, -0.1),
    (-55, 50, 0.13, 0.05, 0.4), (55, 50, 0.13, 0.05, 0.4),
    (0, 12, 0.17, 0.065, 0.7), (-40, 22, 0.17, 0.06, 0.8), (40, 22, 0.17, 0.06, 0.8),
    (180, 30, 0.18, 0.065, 1.0), (-140, 40, 0.17, 0.06, 1.0), (140, 40, 0.17, 0.06, 1.0),
    (-95, 55, 0.14, 0.055, 0.9), (95, 55, 0.14, 0.055, 0.9), (180, 65, 0.15, 0.06, 1.2),
    (-160, 70, 0.13, 0.05, 1.3), (160, 70, 0.13, 0.05, 1.3),
]
for th, ph, ln, rad, back in spikes:
    p, n = on_cap(math.radians(th), math.radians(ph))
    d = (n + Vector((0, -back, 0.35))).normalized()
    if th == 0 and ph < 45:
        d = (n + Vector((0, 0.6, -0.15))).normalized()  # mèche avant
    d = (d + Vector((random.uniform(-0.12, 0.12), 0, random.uniform(-0.05, 0.1)))).normalized()
    cone(p - n * 0.03, d, rad, ln, 'cheveux', 'tete', segs=9)
# mèches avant qui retombent sur le front
for x, tilt in ((-0.07, -0.35), (0.05, 0.3), (0.12, 0.6)):
    p, n = on_cap(math.asin(max(-1, min(1, x / 0.18))), math.radians(58))
    cone(p - n * 0.02, (tilt * 0.4, 0.7, -0.75), 0.04, 0.1, 'cheveux', 'tete', segs=8)

# --- cou, casque audio, capuche, cordons
limb((0, 0, 1.03), (0, 0.005, 1.17), 0.052, 0.05, 'peau', ['torse', 'cou', 'tete'], n=4)
torus((0, 0.015, 1.075), 0.118, 0.017, 'noir', 'torse', rot=(-18, 0, 0), scale=(1.0, 0.95, 1), segs=28, rsegs=8)
for s in (-1, 1):
    blob((0.118 * s, 0.045, 1.05), (0.024, 0.048, 0.048), 'noir', 'torse', rot=(-18, 0, 0), u=16, v=10, power=0.8)
    blob((0.142 * s, 0.045, 1.05), (0.006, 0.032, 0.032), 'neon', 'torse', rot=(-18, 0, 0), u=12, v=8)
blob((0, -0.105, 1.065), (0.155, 0.075, 0.075), 'sweat2', 'torse', u=18, v=12)
for s in (-1, 1):
    tube([(0.04 * s, 0.128, 1.055), (0.043 * s, 0.142, 0.99), (0.046 * s, 0.146, 0.935)], [0.0065] * 3, 'blanc', 'torse', segs=6)
    blob((0.046 * s, 0.146, 0.925), (0.011, 0.011, 0.016), 'blanc', 'torse', u=8, v=6)

# --- sweat
blob((0, 0, 0.87), (0.2, 0.138, 0.245), 'sweat', TORSO, u=26, v=20)
blob((0, 0.112, 0.76), (0.12, 0.03, 0.066), 'sweat2', ['hanches', 'dos'], u=16, v=10, power=0.6)
torus((0, 0, 0.655), 0.19, 0.03, 'sweat2', 'hanches', scale=(1.0, 0.7, 1), segs=28, rsegs=8)
blob((-0.075, 0.128, 0.985), (0.03, 0.008, 0.03), 'neon', 'torse', u=12, v=8)
blob((-0.075, 0.134, 0.985), (0.014, 0.005, 0.014), 'blanc', 'torse', u=8, v=6)

# --- bras
for side, s in (('G', -1), ('D', 1)):
    sh, el, wr = BONES['bras.' + side][0], BONES['bras.' + side][1], BONES['avantbras.' + side][1]
    blob(sh, (0.07, 0.07, 0.07), 'sweat', ['torse', 'bras.' + side], u=16, v=12)
    pts = [Vector(sh).lerp(Vector(el), t / 5) for t in range(6)] + [Vector(el).lerp(Vector(wr), t / 5) for t in range(1, 6)]
    rad = [0.062, 0.06, 0.058, 0.057, 0.056, 0.055, 0.055, 0.054, 0.052, 0.05, 0.048]
    tube(pts, rad, 'sweat', ['bras.' + side, 'avantbras.' + side], segs=14)
    tube([Vector(wr) + (Vector(el) - Vector(wr)).normalized() * 0.03, Vector(wr) + (Vector(wr) - Vector(el)).normalized() * 0.005], [0.054, 0.052], 'sweat2', 'avantbras.' + side, segs=14)
    hand = BONES['main.' + side]
    hc = Vector(hand[0]).lerp(Vector(hand[1]), 0.55)
    blob(hc, (0.042, 0.036, 0.055), 'peau', 'main.' + side, u=14, v=10)
    blob(hc + Vector((-0.018 * s, 0.03, 0.02)), (0.016, 0.016, 0.028), 'peau', 'main.' + side, rot=(20, 0, 0), u=10, v=8)
    if side == 'G':
        torus(Vector(wr) + Vector((0, 0, 0.035)), 0.051, 0.01, 'neon', 'avantbras.G', rot=(0, -14, 0), segs=20, rsegs=6)

# --- bassin et jambes
blob((0, 0, 0.69), (0.17, 0.12, 0.1), 'jean', 'hanches', u=20, v=12)
for side, s in (('G', -1), ('D', 1)):
    hip, knee, ank = BONES['cuisse.' + side][0], BONES['cuisse.' + side][1], BONES['tibia.' + side][1]
    pts = [Vector(hip) + Vector((0, 0, 0.03))] + [Vector(hip).lerp(Vector(knee), t / 5) for t in range(1, 6)] + [Vector(knee).lerp(Vector(ank), t / 5) for t in range(1, 6)]
    rad = [0.08, 0.079, 0.077, 0.074, 0.071, 0.068, 0.067, 0.067, 0.068, 0.07, 0.072]
    tube(pts, rad, 'jean', ['hanches', 'cuisse.' + side, 'tibia.' + side], segs=14)
    torus((ank[0], ank[1], 0.135), 0.073, 0.013, 'jean2', 'tibia.' + side, segs=22, rsegs=6)
    blob((0.178 * s, 0.0, 0.47), (0.024, 0.06, 0.065), 'jean2', 'cuisse.' + side, u=12, v=8, power=0.55)
    # basket
    x = ank[0]
    blob((x, 0.045, 0.072), (0.074, 0.13, 0.068), 'blanc', 'pied.' + side, u=18, v=12, power=0.75)
    blob((x, 0.045, 0.025), (0.082, 0.142, 0.026), 'semelle', 'pied.' + side, u=18, v=10, power=0.4)
    blob((x, 0.095, 0.118), (0.036, 0.052, 0.012), 'noir', 'pied.' + side, rot=(-28, 0, 0), u=12, v=8, power=0.6)
    blob((x + 0.071 * s, 0.03, 0.07), (0.006, 0.075, 0.022), 'sweat', 'pied.' + side, rot=(-12, 0, 0), u=10, v=6, power=0.7)
    torus((x, -0.01, 0.125), 0.062, 0.012, 'noir', 'pied.' + side, scale=(1, 1.15, 1), segs=20, rsegs=6)

# ---------------------------------------------------------------- objet maillage
mesh = bpy.data.meshes.new('HerosMesh')
bm.to_mesh(mesh)
bm.free()
obj = bpy.data.objects.new('Heros', mesh)
scene.collection.objects.link(obj)
for k in MAT_ORDER:
    mesh.materials.append(MATS[k])
for bn in BONE_ORDER:
    obj.vertex_groups.new(name=bn)

# ---------------------------------------------------------------- squelette
arm_data = bpy.data.armatures.new('HerosRig')
arm = bpy.data.objects.new('Rig', arm_data)
scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
arm.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for bn in BONE_ORDER:
    h, t, p = BONES[bn]
    eb = arm_data.edit_bones.new(bn)
    eb.head, eb.tail = Vector(h), Vector(t)
    eb.roll = 0
    if p:
        eb.parent = arm_data.edit_bones[p]
        eb.use_connect = False
    eb.use_deform = bn != 'racine'
bpy.ops.object.mode_set(mode='OBJECT')
obj.parent = arm
mod = obj.modifiers.new('Armature', 'ARMATURE')
mod.object = arm

# ---------------------------------------------------------------- animations
REST = {b.name: b.matrix_local.to_3x3() for b in arm_data.bones}
for pb in arm.pose.bones:
    pb.rotation_mode = 'QUATERNION'

def local_rot(bn, deg):
    """rotation (degrés, axes du personnage X droite / Y devant / Z haut) relative au parent → quaternion local de l'os"""
    R = Euler([math.radians(a) for a in deg], 'XYZ').to_matrix()
    M = REST[bn]
    return (M.inverted() @ R @ M).to_quaternion()

def local_loc(bn, v):
    return REST[bn].inverted() @ Vector(v)

def arm_pose(side, swing=0, out=0, bend=0, twist=0, hand=(0, 0, 0)):
    s = 1 if side == 'G' else -1
    return {
        'bras.' + side: (swing, out * s, twist * s),
        'avantbras.' + side: (bend, 0, 0),
        'main.' + side: hand,
    }

def leg_pose(side, thigh=0, knee=0, foot=0, spread=0):
    s = 1 if side == 'G' else -1
    return {'cuisse.' + side: (thigh, spread * s, 0), 'tibia.' + side: (-knee, 0, 0), 'pied.' + side: (foot, 0, 0)}

def merge(*ds):
    out = {}
    for d in ds:
        out.update(d)
    return out

def make_action(name, keys, loop=True, extra=None):
    """keys : liste de (frame, {os: (rx, ry, rz)}, {os: (x, y, z)} pos, {os: (sx, sy, sz)} échelle)"""
    act = bpy.data.actions.new(name)
    arm.animation_data_create()
    arm.animation_data.action = act
    used_r, used_l, used_s = set(), set(), set()
    for k in keys:
        used_r |= set(k[1].keys())
        if len(k) > 2: used_l |= set(k[2].keys())
        if len(k) > 3: used_s |= set(k[3].keys())
    for k in keys:
        f = k[0]
        rots, locs = k[1], (k[2] if len(k) > 2 else {})
        scs = k[3] if len(k) > 3 else {}
        for bn, r in rots.items():
            pb = arm.pose.bones[bn]
            pb.rotation_quaternion = local_rot(bn, r)
            pb.keyframe_insert('rotation_quaternion', frame=f, group=bn)
        for bn, l in locs.items():
            pb = arm.pose.bones[bn]
            pb.location = local_loc(bn, l)
            pb.keyframe_insert('location', frame=f, group=bn)
        for bn, sc in scs.items():
            pb = arm.pose.bones[bn]
            pb.scale = sc
            pb.keyframe_insert('scale', frame=f, group=bn)
    # quaternions : garder le plus court chemin entre clés
    for fc in act.fcurves:
        if loop:
            fc.modifiers.new('CYCLES')
        fc.update()
    for pb in arm.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)
    track = arm.animation_data.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, int(keys[0][0]), act)
    strip.name = name
    arm.animation_data.action = None
    return act

def mirror(pose):
    """échange gauche / droite d'une pose"""
    out = {}
    for bn, r in pose.items():
        if bn.endswith('.G'): nb = bn[:-1] + 'D'
        elif bn.endswith('.D'): nb = bn[:-1] + 'G'
        else: nb = bn
        if nb != bn:
            out[nb] = (r[0], -r[1], -r[2])
        else:
            out[nb] = (r[0], -r[1], -r[2])
    return out

BASE_ARMS = merge(arm_pose('G', 0, 4, 10), arm_pose('D', 0, 4, 10))

# --- Repos (respiration + clignement)
make_action('Repos', [
    (0, merge(BASE_ARMS, {'torse': (0, 0, 0), 'tete': (0, 0, 0)}), {'hanches': (0, 0, 0)}, {'yeux': (1, 1, 1)}),
    (40, merge(BASE_ARMS, {'torse': (0, 0, 0)}), {}, {'yeux': (1, 1, 1)}),
    (43, {}, {}, {'yeux': (1, 1, 0.08)}),
    (46, {}, {}, {'yeux': (1, 1, 1)}),
    (30, merge(arm_pose('G', 2, 7, 14), arm_pose('D', -2, 7, 14), {'torse': (2.5, 0, 0), 'tete': (2, 0, 3)}), {'hanches': (0, 0, -0.008)}),
    (60, merge(BASE_ARMS, {'torse': (0, 0, 0), 'tete': (0, 0, 0)}), {'hanches': (0, 0, 0)}, {'yeux': (1, 1, 1)}),
])

# --- Marche (cycle de 1 s)
def walk(phase_mirror, contact):
    if contact:
        p = merge(leg_pose('G', 26, 4, 12), leg_pose('D', -22, 14, -12),
                  arm_pose('G', -20, 5, 14), arm_pose('D', 20, 5, 26),
                  {'hanches': (0, 0, 6), 'torse': (0, 0, -8), 'dos': (-4, 0, 0), 'tete': (2, 0, 2)})
        loc = {'hanches': (0, 0, -0.012)}
    else:
        p = merge(leg_pose('G', -2, 6, 0), leg_pose('D', 14, 52, -8),
                  arm_pose('G', 0, 5, 14), arm_pose('D', 0, 5, 18),
                  {'hanches': (0, 0, 0), 'torse': (0, 0, 0), 'dos': (-4, 0, 0), 'tete': (0, 0, 0)})
        loc = {'hanches': (0, 0, 0.022)}
    if phase_mirror:
        p = mirror(p)
    return p, loc
k = []
for f, (m, c) in zip((0, 8, 15, 23, 30), ((False, True), (False, False), (True, True), (True, False), (False, True))):
    p, l = walk(m, c)
    k.append((f, p, l))
make_action('Marche', k)

# --- Course (cycle de 0,67 s)
def run(m, contact):
    if contact:
        p = merge(leg_pose('G', 58, 28, 8), leg_pose('D', -32, 72, -22),
                  arm_pose('G', -48, 8, 88), arm_pose('D', 52, 8, 92),
                  {'hanches': (0, 0, 9), 'torse': (0, 0, -12), 'dos': (-13, 0, 0), 'tete': (8, 0, 3)})
        loc = {'hanches': (0, 0, -0.015)}
    else:
        p = merge(leg_pose('G', 18, 34, 0), leg_pose('D', 6, 110, -10),
                  arm_pose('G', -4, 8, 80), arm_pose('D', 6, 8, 80),
                  {'hanches': (0, 0, 0), 'torse': (0, 0, 0), 'dos': (-13, 0, 0), 'tete': (8, 0, 0)})
        loc = {'hanches': (0, 0, 0.045)}
    if m:
        p = mirror(p)
    return p, loc
k = []
for f, (m, c) in zip((0, 5, 10, 15, 20), ((False, True), (False, False), (True, True), (True, False), (False, True))):
    p, l = run(m, c)
    k.append((f, p, l))
make_action('Course', k)

# --- Saut (une fois, reste en l'air)
make_action('Saut', [
    (0, merge(leg_pose('G', -6, 4, -10), leg_pose('D', -6, 4, -10), arm_pose('G', 40, 30, 30), arm_pose('D', 40, 30, 30), {'dos': (6, 0, 0), 'tete': (-4, 0, 0)}), {'hanches': (0, 0, 0.02)}),
    (7, merge(leg_pose('G', 75, 105, 10), leg_pose('D', 42, 70, 0), arm_pose('G', 25, 70, 45), arm_pose('D', 15, 80, 40), {'dos': (-10, 0, 0), 'tete': (10, 0, 0)}), {'hanches': (0, 0, 0.0)}),
    (14, merge(leg_pose('G', 70, 98, 8), leg_pose('D', 38, 64, 0), arm_pose('G', 20, 75, 40), arm_pose('D', 12, 84, 36), {'dos': (-8, 0, 0), 'tete': (8, 0, 0)}), {'hanches': (0, 0, 0.0)}),
], loop=False)

# --- Chute (bras qui moulinent)
make_action('Chute', [
    (0, merge(leg_pose('G', 32, 45, 5), leg_pose('D', 10, 30, -5), arm_pose('G', 10, 78, 25), arm_pose('D', -5, 70, 20), {'dos': (4, 0, 0), 'tete': (-6, 0, 0)})),
    (12, merge(leg_pose('G', 14, 32, 0), leg_pose('D', 30, 48, 5), arm_pose('G', -6, 88, 15), arm_pose('D', 12, 84, 28), {'dos': (6, 0, 0), 'tete': (-8, 0, 0)})),
    (24, merge(leg_pose('G', 32, 45, 5), leg_pose('D', 10, 30, -5), arm_pose('G', 10, 78, 25), arm_pose('D', -5, 70, 20), {'dos': (4, 0, 0), 'tete': (-6, 0, 0)})),
])

# --- Danse (groove : rebonds, bras qui pompent, balancement)
def groove(f, side_up, down):
    up = 'G' if side_up else 'D'
    dn = 'D' if side_up else 'G'
    sway = 1 if side_up else -1
    knee = 48 if down else 10
    thigh = 26 if down else 6
    p = merge(
        leg_pose('G', thigh, knee, -thigh * 0.3, 6), leg_pose('D', thigh, knee, -thigh * 0.3, 6),
        arm_pose(up, 25 if down else 35, 115 if down else 135, 75 if down else 55),
        arm_pose(dn, -15, 30, 100 if down else 85),
        {'hanches': (0, 0, 14 * sway), 'dos': (-6 if down else 2, 6 * sway, 0), 'torse': (0, 4 * sway, -10 * sway), 'tete': (8 if down else -4, -10 * sway, 6 * sway)},
    )
    loc = {'hanches': (0.035 * sway, 0, -0.06 if down else 0.0)}
    return (f, p, loc)
make_action('Danse', [
    groove(0, True, True), groove(6, True, False), groove(12, True, True), groove(18, True, False),
    groove(24, False, True), groove(30, False, False), groove(36, False, True), groove(42, False, False),
    groove(48, True, True),
])

# --- Salut (coucou de la main droite)
def wave(f, a):
    return (f, merge(arm_pose('D', 18, 150, 30, 0, (0, -a * 0.4, 0)), {'avantbras.D': (25, -a, 0)}, arm_pose('G', 0, 6, 12),
                     {'tete': (2, -8, 6), 'torse': (0, -4, 4)}), {'hanches': (0, 0, -0.004 if a > 0 else 0.004)})
make_action('Salut', [wave(0, 22), wave(10, -18), wave(20, 22), wave(30, -18), wave(40, 22)])

# ---------------------------------------------------------------- export
for o in bpy.context.view_layer.objects:
    o.select_set(o in (obj, arm))
bpy.context.view_layer.objects.active = arm
tris = sum(len(p.vertices) - 2 for p in mesh.polygons)
print('VERTS', len(mesh.vertices), 'TRIS', tris)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format='GLB',
    use_selection=True,
    export_animations=True,
    export_animation_mode='NLA_TRACKS',
    export_skins=True,
    export_morph=False,
    export_yup=True,
    export_apply=False,
    export_optimize_animation_size=True,
    export_force_sampling=True,
    export_frame_step=1,
    export_def_bones=False,
    export_optimize_animation_keep_anim_armature=False,
    export_optimize_animation_keep_anim_object=False,
    export_extras=False,
)
print('EXPORT OK', OUT)
