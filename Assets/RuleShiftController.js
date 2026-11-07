// @input SceneObject nodeTemplate
// @input SceneObject linkTemplate
// @input float strength = 0.8
// @input bool debugAutoToggle = false
// @input bool demoPreset = false
// @input string demoStage = ""
// @input bool lightFx = false
// @input Asset.ObjectPrefab homeModel
// @input Asset.ObjectPrefab catModel
// @input Asset.ObjectPrefab lanternModel
// @input Asset.ObjectPrefab flowerModel
// @input Component.Camera camera
// @input Asset.Material imagineMaterial

// RULESHIFT system: a dynamic set of nodes (max MAX_NODES) + links {A,B,rule,visual}.
// Nodes are spawned from the Create palette (or the demo preset). Each frame every active link adds a force to
// both of its nodes; forces are summed per node, scaled by the node's weight, then integrated. Rules change live.
var RULES = { ATTRACT: "ATTRACT", REPEL: "REPEL", COLLISION_TRIGGER: "COLLISION_TRIGGER", TRANSFER: "TRANSFER", GROW: "GROW" };
var RULE_ORDER = [RULES.ATTRACT, RULES.REPEL, RULES.COLLISION_TRIGGER];   // the quick-cycle order (tests, debug auto-toggle)
var ALL_RULES = [RULES.ATTRACT, RULES.REPEL, RULES.COLLISION_TRIGGER, RULES.TRANSFER, RULES.GROW];   // the order of the rule editor pills
var TOUCH_RULES = {}; TOUCH_RULES[RULES.COLLISION_TRIGGER] = true; TOUCH_RULES[RULES.TRANSFER] = true; TOUCH_RULES[RULES.GROW] = true;   // rules that fire when the two objects touch
var RULE_COLOR = {
    ATTRACT: new vec4(1.0, 0.55, 0.15, 1),  // warm
    REPEL: new vec4(0.2, 0.6, 1.0, 1),      // cool
    COLLISION_TRIGGER: new vec4(0.8, 0.3, 1.0, 1), // violet
    TRANSFER: new vec4(0.2, 0.9, 0.35, 1),  // green
    GROW: new vec4(1.0, 0.72, 0.9, 1)       // pink-white
};
var TRANSFER_KEEP = 0.1, TRANSFER_MIN_SPEED = 0.3;   // the slower object receives 90% of the faster one's velocity
var GROW_STEP = 1.15, GROW_CAP = 2;
var NODE_COLORS = [new vec4(1.0, 0.0, 0.35, 1), new vec4(0.0, 0.85, 1.0, 1), new vec4(1.0, 0.9, 0.0, 1)]; // hot pink, electric cyan, vivid yellow
var MAX_NODES = 8;
var WORLD_Z = -95;
var SIZES = { S: 7, M: 10, L: 14 };            // node scale in cm (diameter of the bounding sphere)
var WEIGHTS = { light: 1.6, heavy: 0.5 };      // multiplies how strongly forces move the node
var BOUNCES = { low: 0, high: 0.85 };          // restitution on collisions and walls

var nodeSeq = 0;
var nodes = [];      // {obj, tr, pos, vel, force, initial, radius, baseScale, pulse, dragging, color, rmv, accel, rest, shape}
var slots = [];      // every link object ever made for a pair; only `active` ones are in `connections`
var connections = [];

var NODE_TMPL = script.nodeTemplate, LINK_TMPL = script.linkTemplate;
var LINK_RMV0 = LINK_TMPL.getComponent("Component.RenderMeshVisual");
var LINK_MESH = LINK_RMV0.mesh, LINK_MAT = LINK_RMV0.mainMaterial;
var SPHERE_MAT = LINK_MAT;       // flat baseColor material (PBR washed colours to pastel)
var SPHERE_MESH = NODE_TMPL.getComponent("Component.RenderMeshVisual").mesh;
NODE_TMPL.enabled = false; LINK_TMPL.enabled = false;

function lerp4(a, b, t) { return new vec4(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t, 1); }
function setNodeColor(n, col) { n.parts.forEach(function (p) { p.rmv.mainPass.baseColor = new vec4(col.r * p.shade, col.g * p.shade, col.b * p.shade, 1); }); }
function nodeIndex(n) { return nodes.indexOf(n); }

// ---------- procedural meshes (unit size: every shape fits in a +-0.5 cube) ----------
var meshCache = {};
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function norm(a) { var l = Math.sqrt(dot(a, a)) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
// Adds one flat-shaded triangle, wound counter-clockwise as seen from outside (ref = a point inside the solid).
function tri(tris, a, b, c, ref) {
    var n = cross(sub(b, a), sub(c, a));
    var g = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    if (dot(n, sub(g, ref || [0, 0, 0])) < 0) { var t = b; b = c; c = t; }
    tris.push([a, b, c]);
}
function buildMesh(tris) {
    var mb = new MeshBuilder([{ name: "position", components: 3 }, { name: "normal", components: 3, normalized: true }, { name: "texture0", components: 2 }]);
    mb.topology = MeshTopology.Triangles; mb.indexType = MeshIndexType.UInt16;
    var verts = [], idx = [], uv = [[0, 0], [1, 0], [0, 1]];
    tris.forEach(function (t) {
        var n = norm(cross(sub(t[1], t[0]), sub(t[2], t[0])));
        for (var k = 0; k < 3; k++) { verts.push(t[k][0], t[k][1], t[k][2], n[0], n[1], n[2], uv[k][0], uv[k][1]); idx.push(idx.length); }
    });
    mb.appendVerticesInterleaved(verts); mb.appendIndices(idx); mb.updateMesh();
    return mb.getMesh();
}
function shapeTris(shape) {
    var T = [], i, h = 0.5;
    if (shape === "cube") {
        var P = [];
        for (i = 0; i < 8; i++) { P.push([(i & 1) ? h : -h, (i & 2) ? h : -h, (i & 4) ? h : -h]); }
        [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]].forEach(function (q) {
            tri(T, P[q[0]], P[q[1]], P[q[2]]); tri(T, P[q[0]], P[q[2]], P[q[3]]);
        });
    } else if (shape === "cone") {
        var N = 20, ring = [];
        for (i = 0; i < N; i++) { var a = i / N * Math.PI * 2; ring.push([Math.cos(a) * h, -h, Math.sin(a) * h]); }
        for (i = 0; i < N; i++) { tri(T, [0, h, 0], ring[i], ring[(i + 1) % N]); tri(T, [0, -h, 0], ring[i], ring[(i + 1) % N]); }
    } else if (shape === "crystal") {
        var S = 6, up = [], lo = [];
        for (i = 0; i < S; i++) { var b = i / S * Math.PI * 2 + 0.3; up.push([Math.cos(b) * 0.3, 0.17, Math.sin(b) * 0.3]); lo.push([Math.cos(b) * 0.3, -0.17, Math.sin(b) * 0.3]); }
        for (i = 0; i < S; i++) {
            var j = (i + 1) % S;
            tri(T, [0, h, 0], up[i], up[j]); tri(T, [0, -h, 0], lo[i], lo[j]);
            tri(T, up[i], lo[i], lo[j]); tri(T, up[i], lo[j], up[j]);
        }
    } else if (shape === "torus") {
        var U = 20, V = 10, R = 0.33, r = 0.17;
        function tp(u, v) { var cu = Math.cos(u), su = Math.sin(u); return [(R + r * Math.cos(v)) * cu, (R + r * Math.cos(v)) * su, r * Math.sin(v)]; }
        for (i = 0; i < U; i++) {
            for (var k = 0; k < V; k++) {
                var u0 = i / U * Math.PI * 2, u1 = (i + 1) / U * Math.PI * 2, v0 = k / V * Math.PI * 2, v1 = (k + 1) / V * Math.PI * 2;
                var c0 = [R * Math.cos(u0), R * Math.sin(u0), 0], c1 = [R * Math.cos(u1), R * Math.sin(u1), 0];
                var ctr = [(c0[0] + c1[0]) / 2, (c0[1] + c1[1]) / 2, 0];
                tri(T, tp(u0, v0), tp(u1, v0), tp(u1, v1), ctr); tri(T, tp(u0, v0), tp(u1, v1), tp(u0, v1), ctr);
            }
        }
    }
    return T;
}
// Flat material has no lighting, so faceted shapes are split into 3 brightness groups (baked light from upper-left-front)
var LIGHT_DIR = norm([-0.4, 0.7, 0.6]), SHADES = [1.0, 0.74, 0.5];
var bucketCache = {};
function getShapeParts(shape) {
    if (shape === "sphere") { return [{ mesh: SPHERE_MESH, shade: 1 }]; }
    if (!bucketCache[shape]) {
        var groups = [[], [], []];
        shapeTris(shape).forEach(function (t) {
            var nrm = norm(cross(sub(t[1], t[0]), sub(t[2], t[0])));
            var d = dot(nrm, LIGHT_DIR);
            groups[d > 0.45 ? 0 : (d > -0.1 ? 1 : 2)].push(t);
        });
        bucketCache[shape] = [];
        groups.forEach(function (g, k) { if (g.length) { bucketCache[shape].push({ mesh: buildMesh(g), shade: SHADES[k] }); } });
    }
    return bucketCache[shape];
}
function getShapeMesh(shape) {
    if (shape === "sphere") { return SPHERE_MESH; }
    if (!meshCache[shape]) { meshCache[shape] = buildMesh(shapeTris(shape)); }
    return meshCache[shape];
}

// ---------- copying scene templates ----------
function cloneTemplate(tmpl, name) {
    var o = tmpl.copyWholeHierarchy(tmpl);
    o.setParent(tmpl.getParent());
    o.name = name; o.enabled = true;
    return o;
}
var pendingBinds = [];   // SIK events are bound once the clone's Interactable has initialised (next frames)

// ---------- nodes ----------
function toColor(c) {
    if (!c) { return NODE_COLORS[nodes.length % NODE_COLORS.length]; }
    if (c.r !== undefined) { return c; }
    return new vec4(c[0], c[1], c[2], 1);
}
function findFreeSpot(radius) {
    var best = new vec3(0, -2, WORLD_Z);
    for (var k = 0; k < (nodes.length < 3 ? 60 : 0); k++) {   // spiral keeps the first few near the centre; later ones are packed on a grid
        var ang = k * 2.39996, rad = k === 0 ? 0 : 3 + k * 0.45;
        var p = new vec3(Math.cos(ang) * rad * 1.1, -2 + Math.sin(ang) * rad * 0.7, WORLD_Z);
        p = new vec3(Math.max(-BOX_X + radius, Math.min(BOX_X - radius, p.x)), Math.max(BOX_YMIN + radius, Math.min(BOX_YMAX - radius, p.y)), WORLD_Z);
        var free = nodes.every(function (n) { return n.pos.distance(p) >= n.radius + radius + 0.5; });
        if (free) { return p; }
        best = p;
    }
    // spiral found nothing: scan the whole box on a fine grid for any free spot
    var x0 = -BOX_X + radius, x1 = BOX_X - radius, y0 = BOX_YMIN + radius, y1 = BOX_YMAX - radius;
    for (var gy = y0; gy <= y1 + 0.001; gy += 0.5) {
        for (var gx = x0; gx <= x1 + 0.001; gx += 0.5) {
            var q = new vec3(gx, gy, WORLD_Z);
            if (nodes.every(function (n) { return n.pos.distance(q) >= n.radius + radius + 0.1; })) { return q; }
        }
    }
    return best;
}
function glowBoost(n) { return n.shape === "sphere" ? 1 : 1.8; }   // slimmer silhouettes (gem, cone...) need a stronger halo to read like the orb's
function addGlow(n) {
    // soft round halo: three nested, very transparent additive spheres (never a scaled copy of the shape, which reads as an outline)
    n.glow = [];
    (script.lightFx ? [[1.7, 0.16]] : [[2.2, 0.05], [1.75, 0.10], [1.35, 0.18]]).forEach(function (L, li) {
        var o = global.scene.createSceneObject("Glow " + li);
        o.setParent(n.obj); o.layer = n.obj.layer;
        var v = o.createComponent("Component.RenderMeshVisual");
        v.mesh = SPHERE_MESH; v.mainMaterial = SPHERE_MAT.clone();
        var p = v.mainPass;
        p.blendMode = BlendMode.Add; p.depthWrite = false;
        var ga = Math.min(0.55, L[1] * glowBoost(n));
        p.baseColor = new vec4(n.color.r * ga, n.color.g * ga, n.color.b * ga, ga);
        v.setRenderOrder(-3 + li);   // drawn before the object so it only shows around it
        o.getTransform().setLocalScale(vec3.one().uniformScale(L[0]));
        n.glow.push(o);
    });
}
function addShine(n) {   // soft specular blob for depth on spheres
    var r = (n.rmv.mesh.aabbMax.x - n.rmv.mesh.aabbMin.x) / 2;
    var o = global.scene.createSceneObject("Shine");
    o.setParent(n.obj); o.layer = n.obj.layer;
    var v = o.createComponent("Component.RenderMeshVisual");
    v.mesh = n.rmv.mesh; v.mainMaterial = SPHERE_MAT.clone(); v.mainPass.baseColor = lerp4(n.color, new vec4(1, 1, 1, 1), 0.7);
    o.getTransform().setLocalScale(vec3.one().uniformScale(0.3));
    o.getTransform().setLocalPosition(new vec3(-0.38, 0.42, 0.62).uniformScale(r));
    n.shine = o;
}
// opts: {shape, color, glow, size (cm), sizeKey, weight, bounce, accel, rest, pos, name, shine}
function spawnNode(opts) {
    opts = opts || {};
    if (nodes.length >= MAX_NODES) { print("RULESHIFT limit reached (" + MAX_NODES + ")"); return null; }
    var shape = opts.shape || "sphere";
    var size = opts.size || SIZES[opts.sizeKey || "M"];
    var col = toColor(opts.color);
    var obj = cloneTemplate(NODE_TMPL, opts.name || (shape + " " + (nodes.length + 1)));
    var rmv = obj.getComponent("Component.RenderMeshVisual");
    var parts = getShapeParts(shape);
    rmv.mesh = parts[0].mesh; rmv.mainMaterial = SPHERE_MAT.clone();
    var partList = [{ rmv: rmv, shade: parts[0].shade }];
    for (var pk = 1; pk < parts.length; pk++) {
        var po = global.scene.createSceneObject("Shade " + pk);
        po.setParent(obj); po.layer = obj.layer;
        var pv = po.createComponent("Component.RenderMeshVisual");
        pv.mesh = parts[pk].mesh; pv.mainMaterial = SPHERE_MAT.clone();
        partList.push({ rmv: pv, shade: parts[pk].shade });
    }
    var tr = obj.getTransform();
    var scale = vec3.one().uniformScale(size);
    tr.setLocalScale(scale);
    var radius = size * 0.5;
    var p = opts.pos ? new vec3(opts.pos.x, opts.pos.y, opts.pos.z === undefined ? WORLD_Z : opts.pos.z) : findFreeSpot(radius);
    tr.setLocalPosition(p);
    var col2 = obj.getComponent("Component.ColliderComponent");
    if (col2 && col2.shape && col2.shape.radius !== undefined) { var sh = col2.shape; sh.radius = 0.5; col2.shape = sh; }
    var n = { obj: obj, tr: tr, pos: new vec3(p.x, p.y, p.z), vel: vec3.zero(), force: vec3.zero(), initial: new vec3(p.x, p.y, p.z),
        id: nodeSeq++, radius: radius, baseScale: scale, growK: 1, pulse: -1, dragging: false, color: col, rmv: rmv, parts: partList, fullMesh: getShapeMesh(shape), shape: shape, size: size,
        accel: opts.accel !== undefined ? opts.accel : (WEIGHTS[opts.weight] || 1),
        rest: opts.rest !== undefined ? opts.rest : (BOUNCES[opts.bounce] || 0), glowOn: !!opts.glow, glow: [] };
    setNodeColor(n, col);
    nodes.push(n);
    if (shape === "sphere" && opts.shine !== false) { addShine(n); }
    if (opts.glow) { addGlow(n); }
    pendingBinds.push({ kind: "node", n: n });
    pendingPlace = opts.pos ? null : n;   // only an object without a position waits for a pinch; presets and explicit positions are already placed
    updateEmptyHint();
    print("RULESHIFT spawned " + obj.name + " (" + nodes.length + "/" + MAX_NODES + ")");
    return n;
}
function deleteNode(n) {
    var i = nodeIndex(n);
    if (i < 0) { return false; }
    for (var k = slots.length - 1; k >= 0; k--) {
        if (slots[k].A === n || slots[k].B === n) { destroySlot(slots[k]); }
    }
    var nm = n.obj.name;
    if (selNode === n) { selNode = null; }
    if (pendingPlace === n) { pendingPlace = null; }
    nodes.splice(i, 1);
    n.obj.destroy();
    refreshConnections(); updateEmptyHint();
    print("RULESHIFT deleted " + nm + " (" + nodes.length + " left)");
    return true;
}

// ---------- Placement: a pinch on a surface puts the newest object there ----------
// Surfaces: a virtual table plane (always available), with WorldQuery tried first when it returns hits.
var TABLE_Y = -19;               // virtual table surface: the stage rests on the Sunlit Room table (placed by eye; WorldQuery returns no hits in Preview)
var pendingPlace = null;         // the newest spawned object waits for a pinch to be placed
var hintObj = null, hintText = null;
(function () {
    var h = makeText("Place Hint", 80, new vec3(0, 26, WORLD_Z), new vec4(0.75, 1, 0.85, 1));
    hintObj = h.obj; hintText = h.text; hintText.text = "Pinch a surface to place it"; hintObj.enabled = false;
})();
var emptyHint = null;
(function () {
    emptyHint = makeText("Empty Hint", 85, new vec3(0, 2, WORLD_Z), new vec4(0.85, 0.95, 1, 1)).obj;
    emptyHint.getComponent("Component.Text").text = "Tap Create to make your first object";
})();
function updateEmptyHint() { if (emptyHint) { emptyHint.enabled = nodes.length === 0; } }
var wqSession = null, wqStatus = "untested";
function initWorldQuery() {
    try {
        var mod = require("LensStudio:WorldQueryModule");
        var opts = HitTestSessionOptions.create();
        opts.filter = true;
        wqSession = mod.createHitTestSessionWithOptions(opts);
        wqSession.start();
        wqStatus = "session created";
    } catch (e) { wqSession = null; wqStatus = "unavailable: " + e; }
    print("RULESHIFT WorldQuery " + wqStatus);
}
function planeHit(o, d) {   // intersect the ray with the table plane; looking at or above the horizon never hits it
    if (d.y > -0.001) { return null; }
    var t = (TABLE_Y - o.y) / d.y;
    return o.add(d.uniformScale(t));
}
function worldDepthHit(o, d) {   // fallback: where the ray crosses the world's depth plane
    var t = (WORLD_Z - o.z) / (Math.abs(d.z) > 0.001 ? d.z : -0.001);
    return o.add(d.uniformScale(Math.max(t, 1)));
}
function placeNodeAt(n, hit, via) {
    var onTable = via === "plane";
    var lx = Math.min(BOX_X, STAGE_R - n.radius);
    var p = new vec3(Math.max(-lx, Math.min(lx, hit.x)),
        onTable ? TABLE_Y + n.radius : hit.y,
        Math.max(WORLD_Z - BOX_Z, Math.min(WORLD_Z + BOX_Z, hit.z)));
    p = new vec3(p.x, Math.max(BOX_YMIN, Math.min(BOX_YMAX, p.y)), p.z);
    n.pos = p; n.initial = new vec3(p.x, p.y, p.z); n.vel = vec3.zero(); n.force = vec3.zero();
    n.tr.setLocalPosition(p);
    if (pendingPlace === n) { pendingPlace = null; }
    print("RULESHIFT placed " + n.obj.name + " via " + via + " at (" + p.x.toFixed(1) + ", " + p.y.toFixed(1) + ", " + p.z.toFixed(1) + ")");
}
// Ray in world space -> place the pending object. Returns the surface used ("plane"/"world") or null when nothing was pending.
function placeFromRay(o, d) {
    if (!pendingPlace) { return null; }
    var n = pendingPlace;
    var hit = planeHit(o, d);
    if (hit) { placeNodeAt(n, hit, "plane"); return "plane"; }
    placeNodeAt(n, worldDepthHit(o, d), "world");
    return "world";
}
// Screen point (0..1) -> ray; ignores presses that land on a button, object or link.
var probe = null;
function placeAtScreen(sp) {
    if (!pendingPlace || !script.camera) { return null; }
    var cam = script.camera, o = cam.getTransform().getWorldPosition();
    var w = cam.screenSpaceToWorldSpace(sp, 100);
    var d = w.sub(o); d = d.uniformScale(1 / Math.max(d.length, 0.0001));
    var blocked = false;
    try {
        probe = probe || Physics.createGlobalProbe();
        probe.rayCast(o, o.add(d.uniformScale(400)), function (hit) { if (hit && hit.collider) { blocked = true; } });
    } catch (e) { }
    if (blocked) { return "blocked"; }
    var target = pendingPlace;
    if (wqSession) {   // real surface first; when it returns no hit the virtual plane is used
        try {
            wqSession.hitTest(o, o.add(d.uniformScale(400)), function (r) {
                if (pendingPlace !== target) { return; }
                if (r && r.position) { wqStatus = "hits"; placeNodeAt(target, r.position, "worldquery"); }
                else { wqStatus = "no hits (plane fallback)"; placeFromRay(o, d); }
            });
            return "worldquery-pending";
        } catch (e2) { wqStatus = "error: " + e2; }
    }
    return placeFromRay(o, d);
}
script.createEvent("TouchStartEvent").bind(function (e) {
    var sp = e.getTouchPosition();
    if (editorLink && script.camera) { var a = screenToAng(sp); editorTouch(a.x, a.y); }
    placeAtScreen(sp);
});

// ---------- links ----------
var HALO_SCALE = 1.7;
function setBeamColor(c, col) { if (c.segs) { for (var i = 0; i < c.segs.length; i++) { c.segs[i].rmv.mainPass.baseColor = col; } } }
function applyColor(c) { if (c.segs) { setBeamColor(c, RULE_COLOR[c.rule]); } }
// A connection is a thin curved beam: BEAM_SEGS additive cylinder segments along a gentle arc, plus BEAM_MOTES small lights flowing source -> target.
var BEAM_SEGS = 8, BEAM_MOTES = 3, BEAM_FLOW = 0.32, fxT = 0;
function makeBeam(c, mesh, mat) {
    var par = NODE_TMPL.getParent();
    var root = global.scene.createSceneObject("Beam");
    if (par) { root.setParent(par); }
    root.layer = NODE_TMPL.layer; root.enabled = false;
    c.beamRoot = root; c.segs = []; c.motes = [];
    for (var i = 0; i < BEAM_SEGS; i++) {
        var o = global.scene.createSceneObject("Beam Seg"); o.setParent(root); o.layer = root.layer;
        var v = o.createComponent("Component.RenderMeshVisual");
        v.mesh = mesh; v.mainMaterial = mat.clone();
        v.mainPass.blendMode = BlendMode.Add; v.mainPass.depthWrite = false; v.setRenderOrder(4);
        c.segs.push({ o: o, tr: o.getTransform(), rmv: v });
    }
    for (var m = 0; m < BEAM_MOTES; m++) {
        var mo = global.scene.createSceneObject("Beam Mote"); mo.setParent(root); mo.layer = root.layer;
        var mv = mo.createComponent("Component.RenderMeshVisual");
        mv.mesh = SPHERE_MESH; mv.mainMaterial = SPHERE_MAT.clone();
        mv.mainPass.blendMode = BlendMode.Add; mv.mainPass.depthWrite = false; mv.setRenderOrder(5);
        c.motes.push({ o: mo, tr: mo.getTransform(), pass: mv.mainPass });
    }
    c.rmv = c.segs[0].rmv;
    c.mCenter = new vec3((mesh.aabbMax.x + mesh.aabbMin.x) / 2, (mesh.aabbMax.y + mesh.aabbMin.y) / 2, (mesh.aabbMax.z + mesh.aabbMin.z) / 2);
    c.mW = Math.max(mesh.aabbMax.x - mesh.aabbMin.x, 0.0001); c.mL = Math.max(mesh.aabbMax.y - mesh.aabbMin.y, 0.0001); c.mD = Math.max(mesh.aabbMax.z - mesh.aabbMin.z, 0.0001);
}
function makeSlot(A, B) {
    var visual = cloneTemplate(LINK_TMPL, "Link " + A.obj.name + "-" + B.obj.name);
    var d = Math.max(A.pos.sub(B.pos).length, 0.1);
    var c = { A: A, B: B, rule: RULES.ATTRACT, visual: visual, rmv: visual.getComponent("Component.RenderMeshVisual"),
        cooldownUntil: 0, baseDist: d };
    // Parent keeps unit scale + the (invisible) collider; a child object carries the thin visible mesh.
    var pmesh = c.rmv.mesh, pmat = c.rmv.mainMaterial;
    c.rmv.enabled = false;
    makeBeam(c, pmesh, pmat);
    visual.getTransform().setLocalScale(vec3.one());
    c.collider = visual.getComponent("Component.ColliderComponent");
    c.pop = -1; c.flash = -1; c.active = false;
    var lo = global.scene.createSceneObject("Rule Label");
    c.labelObj = lo;
    c.label = lo.createComponent("Component.Text");
    c.label.size = 110; c.label.depthTest = false; c.label.renderOrder = 100;
    c.label.outlineSettings.enabled = true; c.label.outlineSettings.size = 0.6;
    c.label.outlineSettings.fill.color = new vec4(0.08, 0.04, 0.25, 1);
    c.label.horizontalAlignment = HorizontalAlignment.Center;
    c.label.verticalAlignment = VerticalAlignment.Center;
    c.labelTr = lo.getTransform();
    applyColor(c);
    visual.enabled = false; lo.enabled = false;   // hidden until the link is created
    slots.push(c);
    pendingBinds.push({ kind: "link", c: c });
    return c;
}
function destroySlot(c) {
    var i = slots.indexOf(c);
    if (i >= 0) { slots.splice(i, 1); }
    c.active = false;
    c.visual.destroy(); c.labelObj.destroy(); c.beamRoot.destroy();
}
function refreshConnections() {
    connections.length = 0;
    slots.forEach(function (c) { if (c.active) { connections.push(c); } });
}
function activateLink(c, rule, quiet) {
    c.active = true; c.rule = rule; c.cooldownUntil = 0;
    c.visual.enabled = true; c.labelObj.enabled = true; c.beamRoot.enabled = true;
    applyColor(c);
    refreshConnections();
    if (!quiet) { c.pop = 0; print("RULESHIFT link created " + c.A.obj.name + "-" + c.B.obj.name + " (" + rule + ")"); }
}
function slotFor(A, B, create) {
    for (var k = 0; k < slots.length; k++) {
        var c = slots[k];
        if ((c.A === A && c.B === B) || (c.A === B && c.B === A)) { return c; }
    }
    return create ? makeSlot(A, B) : null;
}

// Tap-to-link: tap one object to select it, tap a second to link them (one link per pair); tap the same object to cancel.
var selNode = null;
function handleTapNode(n) {
    if (!selNode) { selNode = n; print("RULESHIFT selected " + n.obj.name); return; }
    if (selNode === n) { selNode = null; print("RULESHIFT selection cancelled"); return; }
    var c = slotFor(selNode, n, true);
    if (!c.active) { activateLink(c, RULES.ATTRACT, false); }
    else { print("RULESHIFT already linked"); }
    selNode = null;
}
function pressStartNode(n) { if (pendingPlace === n) { pendingPlace = null; } n.dragging = true; n.tapT = elapsed; n.tapP = n.tr.getLocalPosition(); }
function pressEndNode(n, allowTap) {
    if (nodeIndex(n) < 0) { return; }
    n.dragging = false; var p = n.tr.getLocalPosition(); n.pos = new vec3(p.x, p.y, p.z); n.vel = vec3.zero();
    // only a short press that barely moved counts as a tap-select; drags never do
    if (allowTap && elapsed - n.tapT < 0.35 && p.distance(n.tapP) < 1.5) { handleTapNode(n); }
}
function clearLinks() {
    clearCause();
    slots.forEach(function (c) { c.active = false; c.visual.enabled = false; c.labelObj.enabled = false; c.beamRoot.enabled = false; });
    refreshConnections();
    selNode = null;
    print("RULESHIFT links cleared");
}
function updateSelection() {
    nodes.forEach(function (n) {
        if (n.pulse >= 0) { return; }
        if (n === selNode) {
            var k = 0.5 + 0.5 * Math.sin(elapsed * 8);
            setNodeColor(n, lerp4(n.color, new vec4(1, 1, 1, 1), 0.55));
            n.tr.setLocalScale(n.baseScale.uniformScale(1.1 + 0.1 * k));
            n.selShown = true;
        } else if (n.selShown) {
            setNodeColor(n, n.color); n.tr.setLocalScale(n.baseScale); n.selShown = false;
        }
    });
}

function cycleRule(c, why) {   // a manual edit: the rule changes at once and a short pulse crosses the link so it feels physical
    if (why === "tap") { noteEdit(c); }
    setRule(c, RULE_ORDER[(RULE_ORDER.indexOf(c.rule) + 1) % RULE_ORDER.length], why);
    launchCause(c, "tap", c.A.pos.add(new vec3(0, 0, 0)), c.A, c.B, TAP_PULSE_TIME);
}
function setRule(c, rule, why) {
    c.rule = rule;
    c.pop = 0;
    applyColor(c);
    print("RULESHIFT " + c.A.obj.name + "-" + c.B.obj.name + " rule -> " + rule + " (" + why + ")");
}

var LINK_GAP = 6;  // visible link length when attracted
var REPEL_RANGE = 40, DAMPING = 3.0, MAX_SPEED = 40;
function computeForces() {
    nodes.forEach(function (n) { n.force = vec3.zero(); });
    connections.forEach(function (c) {
        var A = c.A, B = c.B;
        var delta = B.pos.sub(A.pos);
        var dist = Math.max(delta.length, 0.01);
        var dir = delta.uniformScale(1 / dist);   // A -> B
        var f = 0;
        if (c.rule === RULES.ATTRACT) {
            var rest = A.radius + B.radius + LINK_GAP;
            f = dist > rest ? script.strength * 30 * Math.min(1, (dist - rest) / 10) : 0;
        } else if (c.rule === RULES.REPEL) {
            f = dist < REPEL_RANGE ? -script.strength * 60 * (1 - dist / REPEL_RANGE) - 6 : 0;
        }
        // positive f pulls A toward B and B toward A
        A.force = A.force.add(dir.uniformScale(f));
        B.force = B.force.sub(dir.uniformScale(f));
    });
}

var REARM_GAP = 1.5, PULSE_TIME = 0.5, PULSE_AMOUNT = 0.9;
function flip(rule) { return rule === RULES.ATTRACT ? RULES.REPEL : (rule === RULES.REPEL ? RULES.ATTRACT : rule); }
function touchEdge(c) {   // edge-triggered: true once when the pair starts touching, re-armed only after they separate by REARM_GAP
    var dd = c.A.pos.distance(c.B.pos), touchD = c.A.radius + c.B.radius;
    if (c.touching) { if (dd > touchD + REARM_GAP) { c.touching = false; } return false; }
    if (dd > touchD + 0.1) { return false; }
    c.touching = true; c.fires = (c.fires || 0) + 1;
    return true;
}
function applyGrow(n) {   // size follows growK: visual scale, collision radius and the physics collider (node-local units) all scale together
    n.baseScale = vec3.one().uniformScale(n.size * n.growK); n.radius = n.size * 0.5 * n.growK;
    n.tr.setLocalScale(n.baseScale);
}
function growNode(n) { n.growK = Math.min(GROW_CAP, n.growK * GROW_STEP); applyGrow(n); if (n.growK >= GROW_CAP - 1e-9) { discover("growth", n.obj.name + " at max size"); } }
function transferVelocity(A, B) {   // Newton's cradle: the faster object hands most of its velocity to the slower one
    var fast = A.vel.length >= B.vel.length ? A : B, slow = fast === A ? B : A;
    var vf = fast.vel, vs = slow.vel;
    if (vf.length < TRANSFER_MIN_SPEED) { return false; }
    fast.vel = vf.uniformScale(TRANSFER_KEEP).add(vs.uniformScale(1 - TRANSFER_KEEP));
    slow.vel = vs.uniformScale(TRANSFER_KEEP).add(vf.uniformScale(1 - TRANSFER_KEEP));
    return true;
}
function checkCollisions() {
    connections.slice().forEach(function (c) {
        if (!TOUCH_RULES[c.rule]) { c.touching = false; return; }
        var A = c.A, B = c.B;
        if (!touchEdge(c)) { return; }
        A.pulse = 0; B.pulse = 0;
        if (c.rule === RULES.TRANSFER) { var moved = transferVelocity(A, B); if (moved) { discover("cradle", A.obj.name + "-" + B.obj.name); } print("RULESHIFT TRANSFER " + A.obj.name + "-" + B.obj.name + (moved ? "" : " (no motion)")); return; }
        if (c.rule === RULES.GROW) { growNode(A); growNode(B); print("RULESHIFT GROW " + A.obj.name + "-" + B.obj.name + " -> x" + A.growK.toFixed(2) + ", x" + B.growK.toFixed(2)); return; }
        print("RULESHIFT COLLISION " + A.obj.name + "-" + B.obj.name);
        connections.forEach(function (o) {
            if (o === c || TOUCH_RULES[o.rule] || flip(o.rule) === o.rule) { return; }
            if (o.A === A || o.A === B || o.B === A || o.B === B) {
                // cause precedes effect: a pulse travels from the collision point along the link, and the rule flips only when it arrives
                var shared = (o.A === A || o.A === B) ? o.A : o.B, far = shared === o.A ? o.B : o.A;
                var mid = A.pos.add(B.pos).uniformScale(0.5);
                if (!launchCause(o, "flip", mid, shared, far, CAUSE_TIME)) { setRule(o, flip(o.rule), "collision"); o.flash = 0; discover("chain", "immediate flip"); }   // pool exhausted: flip at once rather than lose it
            }
        });
    });
}
// ---------- visible cause chains: pooled glowing pulses (unlit additive head + 3-sphere trail) ----------
var CAUSE_TIME = 0.5, TAP_PULSE_TIME = 0.3, FLASH_TIME = 0.35, CAUSE_POOL = 12;
var CAUSE_SIZES = [3.8, 3.1, 2.4, 1.7], CAUSE_ALPHA = [1, 0.6, 0.35, 0.18], CAUSE_LAG = 0.07;
var WHITE4 = new vec4(1, 1, 1, 1);
var PULSE_PARTS = script.lightFx ? 2 : CAUSE_SIZES.length;   // lightFx (recording only): head plus a 1-sphere trail
var SPHERE_D = Math.max(SPHERE_MESH.aabbMax.x - SPHERE_MESH.aabbMin.x, 0.0001);
var causePool = [], causeActive = [], realDt = 0.016;
function makeCausePulse() {
    var root = global.scene.createSceneObject("Cause Pulse");
    var par = NODE_TMPL.getParent();
    if (par) { root.setParent(par); }
    root.layer = NODE_TMPL.layer;
    root.enabled = false;
    var p = { root: root, parts: [], busy: false, c: null };
    for (var i = 0; i < PULSE_PARTS; i++) {
        var o = global.scene.createSceneObject("Pulse " + i);
        o.setParent(root); o.layer = root.layer;
        var v = o.createComponent("Component.RenderMeshVisual");
        v.mesh = SPHERE_MESH; v.mainMaterial = SPHERE_MAT.clone();
        var ps = v.mainPass;
        ps.blendMode = BlendMode.Add; ps.depthWrite = false; ps.depthTest = false;
        var a = CAUSE_ALPHA[i];
        ps.baseColor = new vec4(1.0 * a, 0.95 * a, 0.75 * a, a);
        v.setRenderOrder(60 - i);
        o.getTransform().setLocalScale(vec3.one().uniformScale(CAUSE_SIZES[i] / SPHERE_D));
        p.parts.push(o.getTransform());
    }
    causePool.push(p);
    return p;
}
function causePointAt(p, s) {   // s in 0..1 along: start point -> shared node -> far node (positions are live, nodes may move)
    var sh = p.shared.pos, fr = p.far.pos;
    var d1 = p.P.distance(sh), d2 = sh.distance(fr);
    var t = s * (d1 + d2);
    if (t <= d1) { return p.P.add(sh.sub(p.P).uniformScale(d1 > 0.001 ? t / d1 : 1)); }
    return sh.add(fr.sub(sh).uniformScale(d2 > 0.001 ? (t - d1) / d2 : 1));
}
function launchCause(c, mode, P, shared, far, dur) {
    var p = null;
    for (var i = 0; i < causePool.length; i++) { if (!causePool[i].busy) { p = causePool[i]; break; } }
    if (!p && causePool.length < CAUSE_POOL) { p = makeCausePulse(); }
    if (!p) { return false; }
    p.busy = true; p.c = c; p.mode = mode; p.P = new vec3(P.x, P.y, P.z); p.shared = shared; p.far = far; p.age = 0; p.dur = dur;
    p.root.enabled = true;
    positionCause(p, 0);
    causeActive.push(p);
    return true;
}
function positionCause(p, u) {
    for (var i = 0; i < p.parts.length; i++) { p.parts[i].setLocalPosition(causePointAt(p, Math.max(0, u - i * CAUSE_LAG))); }
}
function releaseCause(p) {
    p.busy = false; p.c = null; p.root.enabled = false;
    var i = causeActive.indexOf(p);
    if (i >= 0) { causeActive.splice(i, 1); }
}
function updateCause(dt) {
    for (var i = causeActive.length - 1; i >= 0; i--) {
        var p = causeActive[i];
        if (!p.c.active || slots.indexOf(p.c) < 0 || nodeIndex(p.shared) < 0 || nodeIndex(p.far) < 0) { releaseCause(p); continue; }   // link or node deleted mid-flight: no effect
        p.age += dt;
        var u = Math.min(1, p.age / p.dur);
        positionCause(p, u);
        if (u >= 1) {   // arrival: only now does the rule change, and the link flashes
            var c = p.c;
            if (p.mode === "flip" && flip(c.rule) !== c.rule) { setRule(c, flip(c.rule), "collision"); discover("chain", "pulse flip " + c.A.obj.name + "-" + c.B.obj.name); }
            c.flash = 0; c.pop = 0;
            releaseCause(p);
        }
    }
}
function clearCause() {   // Reset / Clear: drop every in-flight pulse WITHOUT applying its pending flip
    for (var i = causeActive.length - 1; i >= 0; i--) { releaseCause(causeActive[i]); }
    slots.forEach(function (c) { if (c.flash >= 0) { c.flash = -1; applyColor(c); } });
}
function updatePulses(dt) {
    nodes.forEach(function (n) {
        if (n.pulse < 0) { return; }
        n.pulse += dt;
        var k = n.pulse >= PULSE_TIME ? 0 : Math.sin(Math.PI * n.pulse / PULSE_TIME);
        if (n.pulse >= PULSE_TIME) { n.pulse = -1; }
        n.tr.setLocalScale(n.baseScale.uniformScale(1 + PULSE_AMOUNT * k));
        setNodeColor(n, lerp4(n.color, new vec4(1, 1, 1, 1), k));
    });
}

function integrate(dt) {
    nodes.forEach(function (n) {
        if (n.dragging) { return; }
        n.vel = n.vel.add(n.force.uniformScale(dt * n.accel)).uniformScale(Math.max(0, 1 - DAMPING * dt));
        var sp = n.vel.length;
        if (sp > MAX_SPEED) { n.vel = n.vel.uniformScale(MAX_SPEED / sp); }
        var p = n.pos.add(n.vel.uniformScale(dt));
        var q = clampToBox(n, p);
        if (n.rest > 0) {   // bouncy walls: reflect the velocity component that hit the wall
            n.vel = new vec3(q.x !== p.x ? -n.vel.x * n.rest : n.vel.x, q.y !== p.y ? -n.vel.y * n.rest : n.vel.y, q.z !== p.z ? -n.vel.z * n.rest : n.vel.z);
        }
        n.pos = q;
        n.tr.setLocalPosition(q);
    });
}
function syncDragged() {   // a grabbed object owns its position; physics resumes from wherever it is released
    nodes.forEach(function (n) {
        if (!n.dragging) { return; }
        n.pos = clampToBox(n, n.tr.getLocalPosition()); n.vel = vec3.zero(); n.force = vec3.zero();
        n.tr.setLocalPosition(n.pos);
    });
}

// ---------- Guided challenge panel (shown only for the demo preset) ----------
var goalEnabled = false;
var goalStage = 0;   // 0: touch goal, 1: celebrating goal 1, 2: triangle goal, 3: all done
var goalTimer = 0, goalPulse = -1, settleTime = 0;
var GOAL_1 = "Make the yellow sphere touch the pink one\n— without dragging it.";
var GOAL_2 = "Get all three spheres to settle in a triangle.";
var GOAL_2_TWO = "Get all three spheres to\nsettle in a triangle.";
var goalTr, goalText, nextText, goalObj, nextObj;
function makeText(name, size, pos, col) {
    var o = global.scene.createSceneObject(name);
    var t = o.createComponent("Component.Text");
    t.size = size; t.depthTest = false;
    t.horizontalAlignment = HorizontalAlignment.Center;
    t.verticalAlignment = VerticalAlignment.Center;
    t.textFill.color = col;
    o.getTransform().setWorldPosition(pos);
    return { obj: o, text: t, tr: o.getTransform() };
}
(function () {
    var g = makeText("Goal Text", 100, new vec3(0, 26, WORLD_Z), new vec4(1, 1, 1, 1));
    var nx = makeText("Next Text", 62, new vec3(0, 20.5, WORLD_Z), new vec4(0.75, 0.9, 1, 0.9));
    goalTr = g.tr; goalText = g.text; nextText = nx.text; goalObj = g.obj; nextObj = nx.obj;
    goalObj.enabled = false; nextObj.enabled = false;
})();
function setGoalEnabled(on) {
    goalEnabled = on; goalStage = 0; settleTime = 0;
    goalObj.enabled = on; nextObj.enabled = on;
    goalText.text = GOAL_1; nextText.text = "Next: " + GOAL_2;
}
function startGoalPulse() { goalPulse = 0; }
function isTriangle() {
    var p = nodes.slice(0, 3).map(function (n) { return n.pos; });
    var d = [p[0].distance(p[1]), p[1].distance(p[2]), p[0].distance(p[2])];
    var mean = (d[0] + d[1] + d[2]) / 3;
    var minD = Math.min(d[0], d[1], d[2]), maxD = Math.max(d[0], d[1], d[2]);
    var minGap = nodes[0].radius * 2;
    // roughly even sides, spheres not overlapping, and not a straight line (longest < sum of others * 0.9)
    return minD > minGap && maxD < mean * 1.5 && maxD < (d[0] + d[1] + d[2] - maxD) * 0.9;
}
function updateGoal(dt) {
    if (!goalEnabled || nodes.length < 3) { return; }
    if (goalPulse >= 0) {
        goalPulse += dt;
        var k = goalPulse >= 0.6 ? 0 : Math.sin(Math.PI * goalPulse / 0.6);
        if (goalPulse >= 0.6) { goalPulse = -1; }
        goalTr.setLocalScale(vec3.one().uniformScale(1 + 0.3 * k));
    }
    if (goalStage === 0) {
        if (state === "live" && !nodes[2].dragging && nodes[2].pos.distance(nodes[0].pos) <= nodes[2].radius + nodes[0].radius + 0.1) {
            goalStage = 1; goalTimer = 0; startGoalPulse();
            goalText.text = "Rule rewritten! ✨";
            print("RULESHIFT goal 1 complete");
        }
    } else if (goalStage === 1) {
        goalTimer += dt;
        if (goalTimer > 3) { goalStage = 2; settleTime = 0; goalText.text = GOAL_2_TWO; nextText.text = ""; }
    } else if (goalStage === 2) {
        var still = nodes.every(function (n) { return n.vel.length < 1.5 && !n.dragging; });
        settleTime = (state === "live" && still && isTriangle()) ? settleTime + dt : 0;
        if (settleTime > 1.5) { goalStage = 3; startGoalPulse(); goalText.text = "Triangle! Rule rewritten! ✨"; print("RULESHIFT goal 2 complete"); }
    }
}
var STAGE_R = 23;
var BOX_X = 17, BOX_YMIN = -16, BOX_YMAX = 8, BOX_Z = 10;   // keeps objects above the buttons and inside the view
function clampToBox(n, p) {
    var lx = Math.min(BOX_X, STAGE_R - n.radius);   // big objects stop at the stage rim
    return new vec3(Math.max(-lx, Math.min(lx, p.x)),
        Math.max(Math.max(BOX_YMIN, -21 + n.radius), Math.min(BOX_YMAX, p.y)),   // big objects also stay above the toolbar (top edge y = -21)
        Math.max(n.initial.z - BOX_Z, Math.min(n.initial.z + BOX_Z, p.z)));
}
// Soft collision: any overlapping pair is pushed apart to exactly touching. A grabbed object is never pushed.
function resolveOverlaps(moveDragged) {   // moveDragged: last resort when the other object is wall-pinned
    for (var i = 0; i < nodes.length; i++) {
        for (var j = i + 1; j < nodes.length; j++) {
            var A = nodes[i], B = nodes[j];
            var d = B.pos.sub(A.pos), dist = d.length, minD = A.radius + B.radius;
            if (dist >= minD) { continue; }
            var dir = dist > 0.001 ? d.uniformScale(1 / dist) : new vec3(1, 0, 0);
            var pen = minD - dist;
            var dA = A.dragging && !moveDragged, dB = B.dragging && !moveDragged;
            var wA = dA ? 0 : (dB ? 1 : 0.5), wB = dB ? 0 : (dA ? 1 : 0.5);
            if (moveDragged && A.dragging !== B.dragging) { wA = A.dragging ? 1 : 0; wB = B.dragging ? 1 : 0; }   // other is pinned: grabbed one yields
            A.pos = A.pos.sub(dir.uniformScale(pen * wA)); B.pos = B.pos.add(dir.uniformScale(pen * wB));
            if (wA > 0) { A.tr.setLocalPosition(A.pos); }
            if (wB > 0) { B.tr.setLocalPosition(B.pos); }
            var e = Math.max(A.rest, B.rest);   // bounce: reflect the approach speed along the contact normal
            if (e > 0 && !A.dragging && !B.dragging) {
                var vrel = B.vel.sub(A.vel).dot(dir);
                if (vrel < 0) { var jn = -(1 + e) * vrel / 2; A.vel = A.vel.sub(dir.uniformScale(jn)); B.vel = B.vel.add(dir.uniformScale(jn)); }
            }
        }
    }
}
var UP = new vec3(0, 1, 0);
var POP_TIME = 0.4, lastDt = 0.016;
var LABEL_TEXT = { ATTRACT: "ATTRACT", REPEL: "REPEL", COLLISION_TRIGGER: "ON COLLISION", TRANSFER: "TRANSFER", GROW: "GROW" };
var labelAlpha = 1;   // labels stay fully opaque in every mode
var LABEL_NUDGE_STEP = 0.8, LABEL_NUDGE_MAX = 40, LABEL_MAX_X = 15;
function labelExtent(c) {   // half-size and centre offset of the label text in world cm (the camera sits at the origin, so depth = -z)
    var bb = c.label.getBoundingBox(), sc = c.labelTr.getWorldScale().x;
    var w = (bb.right - bb.left) * sc, h = (bb.top - bb.bottom) * sc;
    if (!(w > 0) || !(h > 0)) { return null; }
    return { hw: w / 2, hh: h / 2, ox: (bb.left + bb.right) / 2 * sc, oy: (bb.top + bb.bottom) / 2 * sc };
}
var placedLabels = [];
var testPill = null, pillRect = null;   // the Delete pill in screen/angular space {x, y, hw, hh}, pushed by the toolbar script while it is shown
script.api.setPillRect = function (r) { pillRect = r; };   // this frame's already-placed label rectangles (screen/angular space), so labels never sit on each other either
function labelHitsNode(p, e, self) {   // compare in screen (angular) space: label rectangle vs each node's disc and vs the other labels
    var dep = Math.max(-p.z, 1), lx = (p.x + e.ox) / dep, ly = (p.y + e.oy) / dep, hw = e.hw / dep, hh = e.hh / dep;
    for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i], nd = Math.max(-n.pos.z, 1), nr = n.radius / nd;
        var dx = Math.max(Math.abs(lx - n.pos.x / nd) - hw, 0), dy = Math.max(Math.abs(ly - n.pos.y / nd) - hh, 0);
        if (dx * dx + dy * dy < nr * nr) { return true; }
    }
    var pills = [pillRect, testPill, cardRect];
    for (var pi2 = 0; pi2 < 3; pi2++) { var pr = pills[pi2]; if (pr && Math.abs(lx - pr.x) < hw + pr.hw && Math.abs(ly - pr.y) < hh + pr.hh) { return true; } }
    for (var j = 0; j < placedLabels.length; j++) {
        var r = placedLabels[j];
        if (r.c !== self && Math.abs(lx - r.x) < hw + r.hw && Math.abs(ly - r.y) < hh + r.hh) { return true; }
    }
    return false;
}
var labelsAll = false;   // test hook: the suite measures every label; in play only the selected connection shows its rule name
function updateLabel(c) {
    var shown = labelsAll || editorLink === c;
    c.labelObj.enabled = shown && c.active;
    if (!shown) { c.lblRect = null; c.labelNudge = 0; return; }
    var A = c.A.pos, B = c.B.pos;
    var mid = A.add(B).uniformScale(0.5);
    var toCam = mid.uniformScale(-1 / Math.max(mid.length, 0.01));   // camera is at the origin
    var cx = 0; nodes.forEach(function (n) { cx += n.pos.x / nodes.length; });   // side links push their labels outward so labels don't pile up
    var dx = Math.max(-1, Math.min(1, (mid.x - cx) / 6)) * 6.5;
    var lp = mid.add(toCam.uniformScale(22)).add(new vec3(dx, 7, 0));
    lp = new vec3(Math.max(-LABEL_MAX_X, Math.min(LABEL_MAX_X, lp.x)), lp.y, lp.z);   // keep wide labels inside the visible stage (a label at the far rim was clipped)
    // never sit on top of an object: if the label's screen footprint touches any node, nudge it upward until clear
    var ext = labelExtent(c), nudged = 0;
    if (ext) { while (nudged < LABEL_NUDGE_MAX && labelHitsNode(lp, ext, c)) { lp = lp.add(new vec3(0, LABEL_NUDGE_STEP, 0)); nudged += LABEL_NUDGE_STEP; } }
    c.labelNudge = nudged;
    if (ext) { var ddp = Math.max(-lp.z, 1); c.lblRect = { c: c, x: (lp.x + ext.ox) / ddp, y: (lp.y + ext.oy) / ddp, hw: ext.hw / ddp, hh: ext.hh / ddp }; placedLabels.push(c.lblRect); }
    c.labelTr.setWorldPosition(lp);
    c.label.text = LABEL_TEXT[c.rule];
    var k = RULE_COLOR[c.rule];
    c.label.textFill.color = new vec4(k.r, k.g, k.b, labelAlpha);
}
function beamPoint(A, C, B, u) { var a = (1 - u) * (1 - u), b = 2 * u * (1 - u), d = u * u; return new vec3(A.x * a + C.x * b + B.x * d, A.y * a + C.y * b + B.y * d, A.z * a + C.z * b + B.z * d); }
function updateVisual(c) {
    var A = c.A.pos, B = c.B.pos;
    var delta = B.sub(A);
    var dist = Math.max(delta.length, 0.01);
    var dir = delta.uniformScale(1 / dist);
    var tr = c.visual.getTransform();   // the parent keeps the straight, invisible tap collider
    tr.setLocalPosition(A.add(B).uniformScale(0.5));
    tr.setLocalRotation(quat.rotationFromTo(UP, dir));
    var pk = 0;
    if (c.pop >= 0) { c.pop += lastDt; pk = c.pop >= POP_TIME ? 0 : Math.sin(Math.PI * c.pop / POP_TIME); if (c.pop >= POP_TIME) { c.pop = -1; } }
    var col = RULE_COLOR[c.rule];
    if (c.flash >= 0) {   // arrival flash: white-hot, fading back to the (new) rule colour
        c.flash += realDt;
        if (c.flash >= FLASH_TIME) { c.flash = -1; applyColor(c); }
        else { col = lerp4(RULE_COLOR[c.rule], WHITE4, 1 - c.flash / FLASH_TIME); setBeamColor(c, col); }
    }
    var w = Math.max(0.45, Math.min(c.A.radius, c.B.radius) * 0.16) * (1 + 1.2 * pk);   // thin beam
    // gentle arc: always bulges to the left of A -> B, so it never flips side while objects move
    var perp = new vec3(-dir.y, dir.x, 0), h = Math.min(0.12 * dist, 4);
    var mid = A.add(B).uniformScale(0.5), C = mid.add(perp.uniformScale(2 * h));
    c.arcC = C;
    var prev = A;
    for (var i = 0; i < BEAM_SEGS; i++) {
        var nx = beamPoint(A, C, B, (i + 1) / BEAM_SEGS), seg = c.segs[i];
        var d = nx.sub(prev), len = Math.max(d.length, 0.001);
        var rot = quat.rotationFromTo(UP, d.uniformScale(1 / len));
        var sx = w / c.mW, sy = len * 1.0 / c.mL, sz = w / c.mD;
        var mp = prev.add(nx).uniformScale(0.5);
        seg.tr.setWorldRotation(rot);
        seg.tr.setLocalScale(new vec3(sx, sy, sz));
        seg.tr.setWorldPosition(mp.sub(rot.multiplyVec3(new vec3(c.mCenter.x * sx, c.mCenter.y * sy, c.mCenter.z * sz))));
        prev = nx;
    }
    var mcol = lerp4(col, WHITE4, 0.55);   // motes: bright cores in the rule colour
    for (var m = 0; m < BEAM_MOTES; m++) {
        var u = (fxT * BEAM_FLOW + m / BEAM_MOTES + (c.beamPhase || 0)) % 1, mo = c.motes[m];
        mo.tr.setWorldPosition(beamPoint(A, C, B, u).add(new vec3(0, 0, 0.3)));
        var fade = Math.sin(Math.PI * u);
        mo.tr.setLocalScale(vec3.one().uniformScale(w * 2.6 * (0.6 + 0.4 * fade) / SPHERE_D));
        mo.pass.baseColor = new vec4(mcol.r * fade, mcol.g * fade, mcol.b * fade, fade);
    }
    if (c.collider) {   // wide invisible tap target, shorter than the span so objects stay grabbable
        var sh = c.collider.shape;
        sh.size = new vec3(6, Math.max(dist - c.A.radius - c.B.radius, 1), 6);
        c.collider.shape = sh;
    }
}

// ---------- procedural life on models (cheap: a few transform writes per frame, no skeleton) ----------
function modelKind(n) {
    if (n.kind !== undefined) { return n.kind; }
    var nm = String(n.obj.name).toLowerCase(), k = null;
    if (nm.indexOf("cat") === 0) { k = "cat"; } else if (nm.indexOf("lantern") === 0) { k = "lantern"; } else if (nm.indexOf("home") === 0 || nm.indexOf("island") === 0) { k = "home"; } else if (nm.indexOf("flower") === 0) { k = "flower"; }
    n.kind = k; return k;
}
function updateModelLife(dt) {
    for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (!n.modelRoot || !n.mBase) { continue; }
        var k = modelKind(n); if (!k) { continue; }
        var b = n.mBase, ht = n.modelRoot.getTransform(), ph = i * 1.7;
        var p = b.p, r = b.r, s = b.s;
        if (k === "cat") {   // turns to face where it is heading and hops while moving; settles to face the viewer when still
            var sp = n.vel.length, moving = sp > 0.8 ? 1 : 0;
            n.lifeMove = (n.lifeMove || 0) + (moving - (n.lifeMove || 0)) * Math.min(1, dt * 6);
            var tgt = moving ? (n.vel.x >= 0 ? 1 : -1) * 1.2 : 0;
            n.lifeYaw = (n.lifeYaw || 0) + (tgt - (n.lifeYaw || 0)) * Math.min(1, dt * 5);
            r = quat.fromEulerAngles(0, n.lifeYaw, 0).multiply(b.r);
            p = b.p.add(new vec3(0, Math.abs(Math.sin(fxT * 9 + ph)) * 0.05 * n.lifeMove, 0));
        } else if (k === "lantern") {   // sways on its hook
            r = quat.fromEulerAngles(0, 0, Math.sin(fxT * 1.7 + ph) * 0.12).multiply(b.r);
            p = b.p.add(new vec3(Math.sin(fxT * 1.7 + ph) * 0.012, 0, 0));
        } else if (k === "home") {   // floating island bobs
            p = b.p.add(new vec3(0, Math.sin(fxT * 0.9 + ph) * 0.035, 0));
            r = quat.fromEulerAngles(0, 0, Math.sin(fxT * 0.6 + ph) * 0.02).multiply(b.r);
        } else if (k === "flower") {   // soft pulse
            s = b.s.uniformScale(1 + 0.045 * Math.sin(fxT * 2.2 + ph));
        }
        ht.setLocalPosition(p); ht.setLocalRotation(r); ht.setLocalScale(s);
    }
}

// ---------- ambient sparkles: a few soft motes drifting up from glowing objects ----------
var AMB_MAX = 10, AMB_LIFE = 1.8, AMB_RATE = 4.5, ambPool = [], ambActive = [], ambAcc = 0, ambSeed = 12345, ambRound = 0;
function ambRand() { ambSeed = (ambSeed * 1664525 + 1013904223) % 4294967296; return ambSeed / 4294967296; }
function glowEmitters() { var out = []; nodes.forEach(function (n) { var k = n.modelRoot ? modelKind(n) : null; if (k === "lantern" || k === "flower" || (n.glowOn && !n.modelRoot)) { out.push(n); } }); return out; }
function updateAmbient(dt) {
    fxT += dt;
    var em = glowEmitters();
    if (em.length && ambActive.length < AMB_MAX) {
        ambAcc += dt * AMB_RATE;
        while (ambAcc >= 1 && ambActive.length < AMB_MAX) {
            ambAcc -= 1;
            var n = em[ambRound++ % em.length], sp = null;
            for (var q = 0; q < ambPool.length; q++) { if (ambActive.indexOf(ambPool[q]) < 0) { sp = ambPool[q]; break; } }
            if (!sp) {
                var o = global.scene.createSceneObject("Ambient Sparkle"), par = NODE_TMPL.getParent();
                if (par) { o.setParent(par); }
                o.layer = NODE_TMPL.layer; o.enabled = false;
                var v = o.createComponent("Component.RenderMeshVisual");
                v.mesh = SPHERE_MESH; v.mainMaterial = SPHERE_MAT.clone();
                v.mainPass.blendMode = BlendMode.Add; v.mainPass.depthWrite = false; v.mainPass.depthTest = false; v.setRenderOrder(6);
                sp = { o: o, tr: o.getTransform(), pass: v.mainPass }; ambPool.push(sp);
            }
            var a = ambRand() * Math.PI * 2, rr = n.radius * (0.5 + 0.6 * ambRand());
            sp.age = 0; sp.n = n; sp.size = 0.5 + 0.5 * ambRand();
            sp.p = new vec3(n.pos.x + Math.cos(a) * rr, n.pos.y + Math.sin(a) * rr * 0.8, n.pos.z + 0.8);
            sp.col = n.modelRoot && modelKind(n) === "flower" ? new vec4(1, 0.6, 0.85, 1) : (n.modelRoot ? new vec4(1, 0.85, 0.45, 1) : lerp4(n.color, WHITE4, 0.5));
            sp.o.enabled = true; sp.tr.setWorldPosition(sp.p); ambActive.push(sp);
        }
    }
    for (var i = ambActive.length - 1; i >= 0; i--) {
        var s = ambActive[i]; s.age += dt;
        if (s.age >= AMB_LIFE) { s.o.enabled = false; ambActive.splice(i, 1); continue; }
        var u = s.age / AMB_LIFE, al = Math.sin(Math.PI * u) * 0.75;
        s.p = s.p.add(new vec3(Math.sin(s.age * 2.3 + s.size * 9) * 0.25 * dt, 2.2 * dt, 0));
        s.tr.setWorldPosition(s.p);
        s.tr.setLocalScale(vec3.one().uniformScale(s.size * (1 - 0.3 * u) / SPHERE_D));
        s.pass.baseColor = new vec4(s.col.r * al, s.col.g * al, s.col.b * al, al);
    }
}

// ---------- Discoveries: open goals detected from system events (never from specific objects) ----------
var DISCOVERIES = [
    { id: "contact", name: "First contact", hint: "Two objects collide on their own" },
    { id: "chain", name: "Chain reaction", hint: "A collision flips another rule" },
    { id: "growth", name: "Growth spurt", hint: "Grow an object to max size" },
    { id: "cradle", name: "Newton's cradle", hint: "A Transfer hands off motion" },
    { id: "rewrite", name: "Rewrite reality", hint: "Edit a rule live: something reverses" }
];
var discovered = {}, discoveryVer = 0, contacts = {}, pendingRewrite = null, CONTACT_APPROACH = 0.3;
function discover(id, why) {
    if (discovered[id]) { return; }
    discovered[id] = true; discoveryVer++;
    print("RULESHIFT DISCOVERED " + id + " (" + why + ")");
    sparkleBurst();
}
function resetDiscoveries() { discovered = {}; contacts = {}; pendingRewrite = null; discoveryVer++; }
// First contact: a pair that starts touching while the simulation runs, neither being dragged, and approaching each other (a drag shove or a Grow overlap is not a collision).
function detectContacts() {
    var now = {};
    for (var i = 0; i < nodes.length; i++) {
        for (var j = i + 1; j < nodes.length; j++) {
            var A = nodes[i], B = nodes[j], d = B.pos.sub(A.pos), dist = d.length;
            if (dist > A.radius + B.radius + 0.1) { continue; }
            var key = A.id + "_" + B.id; now[key] = true;
            if (contacts[key] || state !== "live" || A.dragging || B.dragging) { continue; }
            var dir = dist > 0.001 ? d.uniformScale(1 / dist) : new vec3(1, 0, 0);
            if (-B.vel.sub(A.vel).dot(dir) > CONTACT_APPROACH) { discover("contact", A.obj.name + "-" + B.obj.name); }
        }
    }
    contacts = now;
}
// Rewrite reality: a rule edited by hand while the simulation runs, then a linked object reverses direction within 3 s.
function noteEdit(c) {
    if (state !== "live") { return; }
    var items = [];
    [c.A, c.B].forEach(function (n) { if (n.vel.length > 1) { items.push({ n: n, v: new vec3(n.vel.x, n.vel.y, n.vel.z) }); } });
    pendingRewrite = items.length ? { items: items, age: 0 } : null;
}
function updateRewrite(dt) {
    if (!pendingRewrite || state !== "live") { return; }
    pendingRewrite.age += dt;
    for (var i = 0; i < pendingRewrite.items.length; i++) {
        var it = pendingRewrite.items[i];
        if (nodeIndex(it.n) >= 0 && !it.n.dragging && it.n.vel.length > 0.8 && it.n.vel.dot(it.v) < 0) { discover("rewrite", it.n.obj.name + " reversed"); pendingRewrite = null; return; }
    }
    if (pendingRewrite.age > 3) { pendingRewrite = null; }
}
// sparkle: a burst of additive sparks where the "Discovered" caption appears
var sparkPool = [], sparkActive = [], SPARK_COUNT = 14, SPARK_LIFE = 0.9;
var SPARK_COLORS = [new vec4(1, 0.95, 0.6, 1), new vec4(1, 0.7, 0.9, 1), new vec4(0.7, 0.95, 1, 1)];
function makeSpark() {
    var o = global.scene.createSceneObject("Sparkle"), par = NODE_TMPL.getParent();
    if (par) { o.setParent(par); }
    o.layer = NODE_TMPL.layer; o.enabled = false;
    var v = o.createComponent("Component.RenderMeshVisual");
    v.mesh = SPHERE_MESH; v.mainMaterial = SPHERE_MAT.clone();
    var ps = v.mainPass; ps.blendMode = BlendMode.Add; ps.depthWrite = false; ps.depthTest = false;
    v.setRenderOrder(70);
    var sp = { o: o, tr: o.getTransform(), pass: ps, age: 0, p: vec3.zero(), v: vec3.zero(), size: 1, col: SPARK_COLORS[0] };
    sparkPool.push(sp);
    return sp;
}
function sparkleBurst() {
    var center = new vec3(0, captionY(script.api.captionCount()), WORLD_Z + 1);
    for (var i = 0; i < SPARK_COUNT; i++) {
        var sp = null;
        for (var k = 0; k < sparkPool.length; k++) { if (sparkActive.indexOf(sparkPool[k]) < 0) { sp = sparkPool[k]; break; } }
        if (!sp) { sp = makeSpark(); }
        var a = i / SPARK_COUNT * Math.PI * 2 + (i % 2) * 0.3, sd = 7 + (i % 3) * 4;
        sp.age = 0; sp.p = new vec3(center.x + (i % 5 - 2) * 4, center.y, center.z); sp.v = new vec3(Math.cos(a) * sd, Math.sin(a) * sd * 0.7 + 2, 0);
        sp.size = 0.9 + (i % 3) * 0.5; sp.col = SPARK_COLORS[i % 3];
        sp.o.enabled = true; sp.tr.setWorldPosition(sp.p);
        sparkActive.push(sp);
    }
}
function updateSparkles(dt) {
    for (var i = sparkActive.length - 1; i >= 0; i--) {
        var sp = sparkActive[i];
        sp.age += dt;
        if (sp.age >= SPARK_LIFE) { sp.o.enabled = false; sparkActive.splice(i, 1); continue; }
        var k = sp.age / SPARK_LIFE, al = (1 - k) * (1 - k);
        sp.p = sp.p.add(sp.v.uniformScale(dt)); sp.tr.setWorldPosition(sp.p);
        sp.tr.setLocalScale(vec3.one().uniformScale(sp.size * (1 + 0.6 * k) / SPHERE_D));
        sp.pass.baseColor = new vec4(sp.col.r * al, sp.col.g * al, sp.col.b * al, al);
    }
}
// The card (TypeScript side draws it): collapsed by default in a top corner; expanded only where it fits clear of objects, labels and the Delete pill.
var CARD = { d: 85, cw: 11, ch: 2.8, pad: 0.8, layouts: [] };
// Expanded layouts, most generous first: the card takes the first one that fits somewhere clear of objects, labels, the Delete pill and the toolbar.
[{ cols: 1, rows: 5, cellW: 14.5, rowH: 2.4, hints: true }, { cols: 1, rows: 5, cellW: 10.5, rowH: 1.7, hints: false }, { cols: 2, rows: 3, cellW: 10.5, rowH: 1.7, hints: false }, { cols: 5, rows: 1, cellW: 8.6, rowH: 1.7, hints: false }].forEach(function (L) {
    L.w = L.cols * L.cellW + 2 * CARD.pad; L.h = CARD.ch + L.rows * L.rowH + CARD.pad; CARD.layouts.push(L);
});
var cardOpen = false, cardSuppressed = false, cardRect = null, cardCorner = -1;
function updateCard() {
    if (cardSuppressed) { cardRect = null; return; }
    var v = script.api.view(), ob = editorObstacles(true, true), step = 1.5 / CARD.d;
    function blocked(cx, cy, hw, hh) { return editorBlocked(cx, cy, hw, hh, ob, 0.8); }
    function scan(w, h) {   // the free spot nearest the preferred top corner (then nearest the other one)
        var hw = w / 2 / CARD.d, hh = h / 2 / CARD.d, best = null, bestC = 1e9, m = 1.0 / CARD.d;
        for (var ci = 0; ci < 2; ci++) {
            var side = ci === 0 ? cardCorner : -cardCorner, ax = side * (v.halfW / 95 - hw - m), ay = v.halfH / 95 - hh - m;
            for (var gy = ay; gy >= toolbarTopAng + hh; gy -= step) {
                for (var gx = ax; Math.abs(gx) <= v.halfW / 95 - hw; gx -= side * step) {
                    var c = Math.hypot(gx - ax, gy - ay) + ci * 0.4;
                    if (c < bestC && !blocked(gx, gy, hw, hh)) { best = { x: gx, y: gy, corner: side }; bestC = c; }
                }
            }
        }
        return best;
    }
    var r = null, li = -1;
    if (cardOpen) { for (var k = 0; k < CARD.layouts.length && !r; k++) { r = scan(CARD.layouts[k].w, CARD.layouts[k].h); li = r ? k : -1; } }
    if (!r) { r = scan(CARD.cw, CARD.ch); li = -1; }
    if (r) {
        cardCorner = r.corner;
        var L = li >= 0 ? CARD.layouts[li] : null;
        r.layout = li; r.expanded = !!L; r.w = L ? L.w : CARD.cw; r.h = L ? L.h : CARD.ch; r.hw = r.w / 2 / CARD.d; r.hh = r.h / 2 / CARD.d;
    }
    cardRect = r;
}
script.api.setCardOpen = function (b) { cardOpen = !!b; };
script.api.setCardSuppressed = function (b) { cardSuppressed = !!b; if (b) { cardRect = null; } };
script.api.cardInfo = function () { return cardRect ? { x: cardRect.x, y: cardRect.y, expanded: cardRect.expanded, layout: cardRect.layout, fits: !cardOpen || cardRect.expanded, corner: cardRect.corner, w: cardRect.w, h: cardRect.h } : null; };
script.api.cardSpec = CARD;
script.api.discoveries = function () { return DISCOVERIES.map(function (d) { return { id: d.id, name: d.name, hint: d.hint, done: !!discovered[d.id] }; }); };
script.api.discoveryVersion = function () { return discoveryVer; };

// ---------- Rule editor: tapping a link opens a panel of all five rules next to it ----------
// The panel is drawn at EDITOR.d (nearer than the world, like the Delete pill) and placed in screen/angular space so it never covers
// an object, a label, the Delete pill, the toolbar or the edge of the view; it is re-placed every frame, so it follows the link.
// Three compact layouts of the same five pills (column, 3x2 grid, row): the view is mostly filled by the stage, so the panel takes whichever fits best beside the link.
var EDITOR = { d: 85, pillW: 8.0, pillH: 3.0, gap: 0.4, pad: 0.6, layouts: [] };
[1, 3, 5].forEach(function (cols) {
    var rows = Math.ceil(ALL_RULES.length / cols);
    EDITOR.layouts.push({ cols: cols, rows: rows, w: cols * EDITOR.pillW + (cols - 1) * EDITOR.gap + 2 * EDITOR.pad, h: rows * EDITOR.pillH + (rows - 1) * EDITOR.gap + 2 * EDITOR.pad });
});
var EDITOR_NAMES = { ATTRACT: "Attract", REPEL: "Repel", COLLISION_TRIGGER: "Collision Trigger", TRANSFER: "Transfer", GROW: "Grow" };
var EDITOR_GRACE = 0.3, EDITOR_MARGIN = 0.9, EDITOR_STEP = 1.5, EDITOR_STICK = 1.5;   // cm: gap kept to everything / scan step / how much worse the current spot may be before it moves
var editorLink = null, editorRect = null, editorOpenedAt = 0, toolbarTopAng = -10;
function screenToAng(sp) {   // screen point (0..1) -> angular position (x/depth, y/depth); the camera sits at the origin looking down -z
    var cam = script.camera, o = cam.getTransform().getWorldPosition(), d = cam.screenSpaceToWorldSpace(sp, 100).sub(o);
    var dep = Math.max(-d.z, 0.0001);
    return { x: d.x / dep, y: d.y / dep };
}
function openEditor(c) {
    editorLink = c; editorRect = null; editorOpenedAt = elapsed;
    print("RULESHIFT editor open " + c.A.obj.name + "-" + c.B.obj.name + " (" + c.rule + ")");
}
function closeEditor(why) {
    if (!editorLink) { return; }
    editorLink = null; editorRect = null;
    print("RULESHIFT editor closed (" + why + ")");
}
function toggleEditor(c) { if (editorLink === c) { closeEditor("link tapped again"); } else { openEditor(c); } }
function applyEditorRule(rule) {   // instant: the simulation keeps running, a short pulse crosses the link like any manual edit
    var c = editorLink;
    if (!c || !c.active || ALL_RULES.indexOf(rule) < 0) { return false; }
    if (c.rule !== rule) { noteEdit(c); setRule(c, rule, "editor"); launchCause(c, "tap", c.A.pos, c.A, c.B, TAP_PULSE_TIME); }
    closeEditor("applied " + rule);
    return true;
}
function editorTouch(ax, ay) {   // a press at angular (ax, ay): outside the panel closes it (a press right after opening is ignored)
    if (!editorLink || elapsed - editorOpenedAt < EDITOR_GRACE) { return false; }
    var m = 0.5 / EDITOR.d, r = editorRect;
    if (r && Math.abs(ax - r.x) <= r.hw + m && Math.abs(ay - r.y) <= r.hh + m) { return false; }
    closeEditor("tap elsewhere");
    return true;
}
function editorObstacles(withNodes, skipCard) {   // everything the panel must keep clear of, in angular space
    var out = { discs: [], rects: [] };
    if (withNodes) { nodes.forEach(function (n) { var nd = Math.max(-n.pos.z, 1); out.discs.push({ x: n.pos.x / nd, y: n.pos.y / nd, r: n.radius / nd }); }); }
    placedLabels.forEach(function (r) { out.rects.push(r); });
    [pillRect, testPill, skipCard ? null : cardRect].forEach(function (r) { if (r) { out.rects.push(r); } });
    return out;
}
function editorBlocked(cx, cy, hw, hh, ob, margin) {
    var v = script.api.view(), m = margin / EDITOR.d;
    if (Math.abs(cx) + hw > v.halfW / 95 - m || cy + hh > v.halfH / 95 - m || cy - hh < toolbarTopAng + m) { return true; }
    for (var i = 0; i < ob.discs.length; i++) {
        var d = ob.discs[i], dx = Math.max(Math.abs(cx - d.x) - hw, 0), dy = Math.max(Math.abs(cy - d.y) - hh, 0), rr = d.r + m;
        if (dx * dx + dy * dy < rr * rr) { return true; }
    }
    for (var j = 0; j < ob.rects.length; j++) {
        var r = ob.rects[j];
        if (Math.abs(cx - r.x) < hw + r.hw + m && Math.abs(cy - r.y) < hh + r.hh + m) { return true; }
    }
    return false;
}
function updateEditor() {
    if (!editorLink) { editorRect = null; return; }
    var c = editorLink;
    if (!c.active || slots.indexOf(c) < 0) { closeEditor("link removed"); return; }
    var v = script.api.view();
    var A = c.A.pos, B = c.B.pos, pts = [];
    for (var k = 0; k <= 4; k++) { var q = A.add(B.sub(A).uniformScale(k / 4)), qd = Math.max(-q.z, 1); pts.push({ x: q.x / qd, y: q.y / qd }); }
    var mx = pts[2].x, my = pts[2].y;
    function cost(cx, cy, hw, hh) {   // distance to the link's middle, heavily penalised when the panel would cover the link itself
        var cv = 0;
        for (var i = 0; i < pts.length; i++) { if (Math.abs(pts[i].x - cx) < hw && Math.abs(pts[i].y - cy) < hh) { cv = 0.5; break; } }
        return Math.sqrt((cx - mx) * (cx - mx) + (cy - my) * (cy - my)) + cv;
    }
    var ob = editorObstacles(true), ob2 = null, step = EDITOR_STEP / EDITOR.d;
    var best = null, bestCost = 1e9, overlap = false;
    function scan(obs) {
        EDITOR.layouts.forEach(function (L, li) {
            var hw = L.w / 2 / EDITOR.d, hh = L.h / 2 / EDITOR.d;
            for (var gy = -v.halfH / 95 + hh; gy <= v.halfH / 95 - hh + 1e-6; gy += step) {
                for (var gx = -v.halfW / 95 + hw; gx <= v.halfW / 95 - hw + 1e-6; gx += step) {
                    var cc = cost(gx, gy, hw, hh);
                    if (cc >= bestCost) { continue; }
                    if (!editorBlocked(gx, gy, hw, hh, obs, EDITOR_MARGIN)) { best = { x: gx, y: gy, li: li, hw: hw, hh: hh }; bestCost = cc; }
                }
            }
        });
    }
    scan(ob);
    if (!best) { ob2 = editorObstacles(false); scan(ob2); overlap = !!best; }   // crowded: keep clear of labels and the toolbar at least
    if (!best) {
        var L0 = EDITOR.layouts[1], h0 = L0.w / 2 / EDITOR.d, k0 = L0.h / 2 / EDITOR.d;
        best = { x: Math.max(-v.halfW / 95 + h0, Math.min(v.halfW / 95 - h0, mx)), y: Math.max(toolbarTopAng + k0, Math.min(v.halfH / 95 - k0, my)), li: 1, hw: h0, hh: k0 }; overlap = true;
    }
    if (editorRect && !overlap) {   // stay put (same layout) unless a clearly better spot exists
        var cur = EDITOR.layouts[editorRect.li], chw = cur.w / 2 / EDITOR.d, chh = cur.h / 2 / EDITOR.d;
        if (!editorBlocked(editorRect.x, editorRect.y, chw, chh, ob, EDITOR_MARGIN) && cost(editorRect.x, editorRect.y, chw, chh) <= bestCost + EDITOR_STICK / 95) {
            best = { x: editorRect.x, y: editorRect.y, li: editorRect.li, hw: chw, hh: chh };
        }
    }
    editorRect = { x: best.x, y: best.y, hw: best.hw, hh: best.hh, li: best.li, overlap: overlap };
}
script.api.setToolbarTop = function (ang) { toolbarTopAng = ang; };
script.api.editorSpec = EDITOR;
script.api.editorRules = function () { return ALL_RULES.map(function (r) { var k = RULE_COLOR[r]; return { rule: r, name: EDITOR_NAMES[r], color: [k.r, k.g, k.b] }; }); };
script.api.editorInfo = function () { return editorLink && editorRect ? { x: editorRect.x, y: editorRect.y, rule: editorLink.rule, layout: editorRect.li } : null; };
script.api.applyEditorRule = applyEditorRule;
script.api.closeEditor = function () { closeEditor("closed"); };

// Modes: creation (stationary, start) -> live <-> paused. Reset -> creation.
var state = "creation";
var stateListeners = [];
function setState(st) {
    state = st;
    print("RULESHIFT state -> " + st);
    stateListeners.forEach(function (f) { f(st); });
}
function resetWorld() {   // restores positions; created objects and links are kept
    nodes.forEach(function (n) {
        n.pos = new vec3(n.initial.x, n.initial.y, n.initial.z);
        n.vel = vec3.zero(); n.force = vec3.zero(); n.pulse = -1; n.dragging = false;
        n.growK = 1; applyGrow(n);
        n.tr.setLocalPosition(n.pos);
    });
    clearCause(); contacts = {}; pendingRewrite = null;
    connections.forEach(function (c) { c.cooldownUntil = 0; c.touching = false; updateVisual(c); });
    selNode = null;
    if (goalEnabled) { goalStage = 0; settleTime = 0; goalText.text = GOAL_1; nextText.text = "Next: " + GOAL_2; }
    setState("creation");
}
function clearAll() {
    clearCause();
    for (var k = slots.length - 1; k >= 0; k--) { destroySlot(slots[k]); }
    for (var i = nodes.length - 1; i >= 0; i--) { nodes[i].obj.destroy(); }
    nodes.length = 0; refreshConnections(); updateEmptyHint(); resetDiscoveries();
    selNode = null; pendingPlace = null; setGoalEnabled(false);
    setState("creation");
    print("RULESHIFT cleared all");
}
function loadDemo() {   // the starting set used for the video: pink, cyan, yellow spheres; pink-cyan attract, cyan-yellow repel
    clearAll();
    var a = spawnNode({ shape: "sphere", color: NODE_COLORS[0], size: 10, accel: 1, rest: 0, pos: new vec3(-12, -9, WORLD_Z), name: "Sphere A" });
    var b = spawnNode({ shape: "sphere", color: NODE_COLORS[1], size: 10, accel: 1, rest: 0, pos: new vec3(12, -9, WORLD_Z), name: "Sphere B" });
    var c = spawnNode({ shape: "sphere", color: NODE_COLORS[2], size: 10, accel: 1, rest: 0, pos: new vec3(0, 4, WORLD_Z), name: "Sphere C" });
    var ab = slotFor(a, b, true), bc = slotFor(b, c, true); slotFor(a, c, true);   // slot order AB, BC, AC
    activateLink(ab, RULES.ATTRACT, true); activateLink(bc, RULES.REPEL, true);
    setGoalEnabled(true);
    pendingPlace = null;
}

// Recording setup (demoPreset): the opening is an empty stage; demoStage = "chain" starts with gem, orb and cube spread across
// the stage and linked (light orb, heavy gem, large cube): gem-orb ATTRACT (the pull) and orb-cube COLLISION TRIGGER (the chain reaction: when the orb meets the cube
// a pulse runs down the gem-orb link and flips it to REPEL). Press Play to start it.
function loadChain() {
    clearAll();
    var gem = spawnNode({ shape: "crystal", color: NODE_COLORS[0], size: 10, glow: true, weight: "heavy", pos: new vec3(13, 4, WORLD_Z), name: "Gem" });
    var orb = spawnNode({ shape: "sphere", color: NODE_COLORS[1], size: 10, weight: "light", pos: new vec3(-13, 4, WORLD_Z), name: "Orb" });
    var cube = spawnNode({ shape: "cube", color: NODE_COLORS[2], size: 10, pos: new vec3(-2, -4, WORLD_Z), name: "Cube" });
    activateLink(slotFor(gem, orb, true), RULES.ATTRACT, true);
    activateLink(slotFor(orb, cube, true), RULES.COLLISION_TRIGGER, true);
    pendingPlace = null;   // everything is already placed: no placement hint
    print("RULESHIFT demo stage: chain");
}
// demoStage "universe": library house on a floating island (heavy, 1.5x), cat (light, 0.7x), lantern and flower at base size 12 cm, from saved models.
// Links: cat-lantern ATTRACT, lantern-flower COLLISION TRIGGER, cat-home ATTRACT. The cat pulls the lantern across the stage into the flower;
// the collision sends a pulse down the lantern's link and flips cat-lantern to REPEL. Layout: the cat starts beside the house, the lantern drifts in from the
// lower right through the flower; the cat is drawn toward the lantern (away from the house), then after the flip retreats to the house and settles.
function loadUniverse() {
    // A hand-triggered chain: the cat chases the lantern across the stage, nothing collides by itself, and dragging the lantern into the flower
    // fires the Collision Trigger, which flips cat-lantern to REPEL so the cat is pushed back home. Home top-left, cat beside it, lantern bottom-right, flower top-right.
    clearAll();
    var base = 12;
    var home = spawnModelNode(script.homeModel, "Home", base * 1.5, "heavy", new vec3(-14, 7, WORLD_Z), NODE_COLORS[2]);
    var cat = spawnModelNode(script.catModel, "Cat", base * 0.7, "light", new vec3(0.2, 7.6, WORLD_Z), NODE_COLORS[0]);
    var lantern = spawnModelNode(script.lanternModel, "Lantern", base * 0.85, "heavy", new vec3(17, -16, WORLD_Z), NODE_COLORS[1]);
    var flower = spawnModelNode(script.flowerModel, "Flower", base, null, new vec3(16, 5.5, WORLD_Z), NODE_COLORS[0]);
    if (home && cat && lantern && flower) {
        activateLink(slotFor(lantern, flower, true), RULES.COLLISION_TRIGGER, true);   // first, so its label gets the spot nearest its link
        activateLink(slotFor(cat, lantern, true), RULES.ATTRACT, true);
        activateLink(slotFor(cat, home, true), RULES.ATTRACT, true);
    }
    pendingPlace = null;
    print("RULESHIFT demo stage: universe");
}
script.api.loadUniverse = loadUniverse;
function applyDemoSetup() {
    if (script.demoStage === "chain") { loadChain(); } else if (script.demoStage === "universe") { loadUniverse(); } else { clearAll(); pendingPlace = null; }
}
script.api.loadChain = loadChain;
script.api.applyDemoSetup = applyDemoSetup;
script.api.getState = function () { return state; };
script.api.onState = function (f) { stateListeners.push(f); f(state); };
script.api.activate = function () { if (state === "creation") { setState("live"); } };
script.api.pause = function () { if (state === "live") { setState("paused"); } };
script.api.resume = function () { if (state === "paused") { setState("live"); } };
script.api.toggle = function () {   // Activate -> Pause -> Resume -> Pause ...
    if (state === "live") { script.api.pause(); } else if (state === "paused") { script.api.resume(); } else { script.api.activate(); }
};
script.api.reset = resetWorld;
script.api.clearLinks = clearLinks;
script.api.clearAll = clearAll;
script.api.loadDemo = loadDemo;
script.api.spawn = function (opts) { var n = spawnNode(opts); return n ? nodeIndex(n) : -1; };
script.api.pendingPlacement = function () { return pendingPlace ? nodeIndex(pendingPlace) : -1; };
script.api.placeFromRay = placeFromRay;
script.api.placeAtScreen = placeAtScreen;
script.api.wqStatus = function () { return wqStatus; };
script.api.tableY = TABLE_Y;
script.api.count = function () { return nodes.length; };
script.api.maxNodes = MAX_NODES;
script.api.deleteSelected = function () { return selNode ? deleteNode(selNode) : false; };
script.api.selectedInfo = function () {
    if (!selNode) { return null; }
    // busy: an "Imagining…" / failure caption is showing above this node, so the Delete pill stays hidden (it would overlap the caption)
    return { x: selNode.pos.x, y: selNode.pos.y, z: selNode.pos.z, r: selNode.radius, busy: !!(selNode.job && selNode.job.cap) };
};
// UI helpers for the palette (TypeScript side): an opaque plate and a round colour swatch, built from the shared meshes.
script.api.makePlate = function (name, w, h, d, pos, col, order) {
    var o = global.scene.createSceneObject(name);
    var v = o.createComponent("Component.RenderMeshVisual");
    v.mesh = LINK_MESH; v.mainMaterial = SPHERE_MAT.clone(); v.mainPass.baseColor = col;
    if (order !== undefined) { v.mainPass.depthTest = false; v.setRenderOrder(order); }   // drawn beneath the UI buttons regardless of depth
    var mn = LINK_MESH.aabbMin, mx = LINK_MESH.aabbMax;
    var mw = Math.max(mx.x - mn.x, 0.0001), ml = Math.max(mx.y - mn.y, 0.0001), md = Math.max(mx.z - mn.z, 0.0001);
    var t = o.getTransform();
    t.setWorldRotation(quat.fromEulerAngles(0, 0, Math.PI / 2));   // mesh long axis is Y; lay it along X
    t.setWorldScale(new vec3(h / mw, w / ml, d / md));
    t.setWorldPosition(pos);
    return o;
};
script.api.makeSwatch = function (parent, col, size, z) {
    var o = global.scene.createSceneObject("Swatch");
    o.setParent(parent);
    var v = o.createComponent("Component.RenderMeshVisual");
    v.mesh = SPHERE_MESH; v.mainMaterial = SPHERE_MAT.clone(); v.mainPass.baseColor = new vec4(col[0], col[1], col[2], 1);
    o.getTransform().setLocalScale(new vec3(size, size, size * 0.2));
    o.getTransform().setLocalPosition(new vec3(0, 0, z));
    return o;
};
var frameCount = 0;
script.api.test = {
    pillRect: function () { return pillRect; },
    setTestPill: function (r) { testPill = r; },
    setFixedStep: function (s) { fixedStep = s; }, fixedStep: function () { return fixedStep; },   // read/write hooks for RuleShiftTests.js
    nodes: nodes, connections: connections, slots: slots,
    tap: function (i) { handleTapNode(nodes[i]); },
    pressStart: function (i) { pressStartNode(nodes[i]); },
    pressEnd: function (i, allowTap) { pressEndNode(nodes[i], allowTap); },
    growNode: growNode, applyGrow: applyGrow, GROW_CAP: GROW_CAP,
    discovered: function () { return DISCOVERIES.filter(function (d) { return discovered[d.id]; }).map(function (d) { return d.id; }); },
    sparkleActive: function () { return sparkActive.length; },
    cardOverlaps: function () {
        if (!cardRect) { return -1; }
        var ob = editorObstacles(true, true), r = cardRect, n = 0, v = script.api.view();
        ob.discs.forEach(function (d) { var dx = Math.max(Math.abs(r.x - d.x) - r.hw, 0), dy = Math.max(Math.abs(r.y - d.y) - r.hh, 0); if (dx * dx + dy * dy < d.r * d.r) { n++; } });
        ob.rects.forEach(function (o) { if (Math.abs(r.x - o.x) < r.hw + o.hw && Math.abs(r.y - o.y) < r.hh + o.hh) { n++; } });
        if (Math.abs(r.x) + r.hw > v.halfW / 95 || r.y + r.hh > v.halfH / 95 || r.y - r.hh < toolbarTopAng) { n++; }
        return n;
    },
    openEditor: openEditor, closeEditor: function () { closeEditor("test"); }, editorTouch: editorTouch, toggleEditor: toggleEditor,
    editorOpen: function () { return editorLink ? slots.indexOf(editorLink) : -1; },
    editorRect: function () { return editorRect; },
    editorOverlaps: function () {   // how many things the placed panel covers (nodes, labels, Delete pill) plus whether it leaves the view / touches the toolbar
        if (!editorRect) { return -1; }
        var ob = editorObstacles(true), r = editorRect, n = 0, v = script.api.view();
        ob.discs.forEach(function (d) { var dx = Math.max(Math.abs(r.x - d.x) - r.hw, 0), dy = Math.max(Math.abs(r.y - d.y) - r.hh, 0); if (dx * dx + dy * dy < d.r * d.r) { n++; } });
        ob.rects.forEach(function (o) { if (Math.abs(r.x - o.x) < r.hw + o.hw && Math.abs(r.y - o.y) < r.hh + o.hh) { n++; } });
        if (Math.abs(r.x) + r.hw > v.halfW / 95 || r.y + r.hh > v.halfH / 95 || r.y - r.hh < toolbarTopAng) { n++; }
        return n;
    },
    editorMid: function () { var c = editorLink; if (!c) { return null; } var m = c.A.pos.add(c.B.pos).uniformScale(0.5), d = Math.max(-m.z, 1); return { x: m.x / d, y: m.y / d }; },
    clearLinks: clearLinks, selected: function () { return selNode ? nodeIndex(selNode) : -1; }, setRule: setRule, cycleRule: cycleRule,
    pendingBinds: function () { return pendingBinds.length; },
    cause: {
        active: function () { return causeActive.length; },
        enabled: function () { return causePool.filter(function (p) { return p.root.enabled; }).length; },
        poolSize: function () { return causePool.length; },
        info: function () { return causeActive.map(function (p) { return { mode: p.mode, age: p.age, dur: p.dur, rule: p.c.rule, link: slots.indexOf(p.c) }; }); },
        headPos: function (k) { var p = causeActive[k]; return p ? p.parts[0].getLocalPosition() : null; },
        flash: function (c) { return c.flash; },
        setTime: function (t) { CAUSE_TIME = t; }
    },
    deleteNode: function (i) { return deleteNode(nodes[i]); },
    box: { x: BOX_X, yMin: BOX_YMIN, yMax: BOX_YMAX, zr: BOX_Z, buttonTop: -21 },
    goalStage: function () { return goalStage; },
    frames: function () { return frameCount; },
    labelsAll: function (v) { if (v !== undefined) { labelsAll = !!v; } return labelsAll; },
    beamInfo: function (c) {
        var A = c.A.pos, B = c.B.pos, mid = A.add(B).uniformScale(0.5), sm = c.segs[Math.floor(BEAM_SEGS / 2)].tr.getWorldPosition();
        var dir = B.sub(A).normalize(), off = sm.sub(mid), perp = off.sub(dir.uniformScale(off.dot(dir)));
        return { segs: c.segs.length, motes: c.motes.length, bulge: perp.length, root: c.beamRoot.enabled, labelOn: c.labelObj.enabled,
            moteU: c.motes.map(function (m) { return m.tr.getWorldPosition(); }), moteAlpha: c.motes.map(function (m) { return m.pass.baseColor.a; }) };
    },
    lifeInfo: function (i) { var n = nodes[i]; if (!n.modelRoot) { return null; } var q = n.modelRoot.getTransform(); return { kind: modelKind(n), rot: q.getLocalRotation().toEulerAngles(), pos: q.getLocalPosition(), scale: q.getLocalScale(), yaw: n.lifeYaw || 0, move: n.lifeMove || 0 }; },
    ambientCount: function () { return ambActive.length; },
    ambientMax: AMB_MAX,
    linkColor: function (c) { var k = c.rmv.mainPass.baseColor; return k.r.toFixed(2) + "," + k.g.toFixed(2) + "," + k.b.toFixed(2); },
    place: function (i, v) { var n = nodes[i]; n.pos = new vec3(v.x, v.y, v.z); n.vel = vec3.zero(); n.tr.setLocalPosition(n.pos); if (pendingPlace === n) { pendingPlace = null; } },
    connect: function (i, j, rule) { var c = slotFor(nodes[i], nodes[j], true); if (!c.active) { activateLink(c, rule || RULES.ATTRACT, true); } return c; },
    labelInfo: function (c) { var e = labelExtent(c); var p = c.labelTr.getWorldPosition(); return { ext: e, nudge: c.labelNudge, y: p.y, hits: e ? labelHitsNode(p, e, c) : null }; },
    fires: function (c) { return c.fires || 0; },
    hintVisible: function () { return hintObj.enabled; },
    labelOverlaps: function () { var n = 0, cs = connections; for (var i = 0; i < cs.length; i++) { for (var j = i + 1; j < cs.length; j++) { var a = cs[i].lblRect, b = cs[j].lblRect; if (a && b && Math.abs(a.x - b.x) < a.hw + b.hw && Math.abs(a.y - b.y) < a.hh + b.hh) { n++; } } } return n; },
    glowInfo: function (i) { var n = nodes[i]; return n.glow.map(function (o) { var p = o.getComponent("Component.RenderMeshVisual").mainPass; return { blend: p.blendMode, alpha: p.baseColor.a }; }); }
};

var SUBSTEP = 0.02, MAX_SUBSTEPS = 6, fixedStep = 0;   // fixedStep > 0 (tests only) replaces real dt with a constant step
var elapsed = 0, lastToggle = 0;
script.createEvent("UpdateEvent").bind(function (e) {
    var fdt = fixedStep > 0 ? fixedStep : e.getDeltaTime();   // tests run on a fixed simulation clock: every time source below advances by the same step per frame, independent of host load
    var dt = Math.min(fdt, 0.05);
    frameCount++;
    lastDt = dt;
    realDt = Math.min(fdt, 0.25);   // wall-clock step: cause pulses and flashes keep real-time pacing at low Preview fps
    elapsed += fdt;
    // bind SIK events on clones once their Interactable has initialised
    for (var pi = pendingBinds.length - 1; pi >= 0; pi--) {
        var pb = pendingBinds[pi], done = false, obj = pb.kind === "node" ? pb.n.obj : pb.c.visual;
        if (pb.kind === "node" ? nodeIndex(pb.n) < 0 : slots.indexOf(pb.c) < 0) { pendingBinds.splice(pi, 1); continue; }
        obj.getComponents("Component.ScriptComponent").forEach(function (sc) {
            if (done || !(sc.onTriggerStart && sc.onTriggerEnd)) { return; }
            done = true;
            if (pb.kind === "node") {
                var n = pb.n;
                sc.onTriggerStart.add(function () { pressStartNode(n); });
                sc.onTriggerEnd.add(function () { pressEndNode(n, true); });
                if (sc.onTriggerCanceled) { sc.onTriggerCanceled.add(function () { pressEndNode(n, false); }); }
            } else {
                var c = pb.c;
                sc.onTriggerStart.add(function () { if (c.active) { toggleEditor(c); } });
            }
        });
        if (done) { pendingBinds.splice(pi, 1); }
    }
    if (state === "live" && script.debugAutoToggle && elapsed - lastToggle >= 3 && connections.length) {
        lastToggle = elapsed;
        cycleRule(connections[0], "auto");
    }
    syncDragged();
    if (state === "live") {   // real elapsed time, split into fixed substeps so motion keeps real-time speed at low fps without going unstable
        var total = fixedStep > 0 ? fixedStep : Math.min(fdt, MAX_SUBSTEPS * SUBSTEP);
        var steps = Math.max(1, Math.min(MAX_SUBSTEPS, Math.ceil(total / SUBSTEP - 1e-6)));
        lastDt = total;
        for (var si = 0; si < steps; si++) {
            computeForces();
            integrate(total / steps);
        }
    }
    detectContacts();
    for (var it = 0; it < 6; it++) {   // push apart, then re-clamp so a shove can never leave the box
        resolveOverlaps(it >= 2);
        nodes.forEach(function (n) { if (!n.dragging || it >= 2) { n.pos = clampToBox(n, n.pos); n.tr.setLocalPosition(n.pos); } });
    }
    if (state === "live") { checkCollisions(); }
    updatePulses(dt);
    updateCause(realDt);
    updateRewrite(realDt); updateSparkles(realDt); updateAmbient(realDt); updateModelLife(realDt);
    updateImagine(dt);
    updateSelection();
    hintObj.enabled = !!pendingPlace && !goalEnabled;
    updateGoal(Math.min(fdt, 0.25));   // real time, so goal timers don't slow down at low frame rates
    placedLabels.length = 0;
    connections.forEach(updateLabel);
    connections.forEach(updateVisual);
    updateCard();
    updateEditor();
});
script.createEvent("OnStartEvent").bind(function () {
    if (script.demoPreset) { applyDemoSetup(); }
    initWorldQuery();
    var wqDelay = script.createEvent("DelayedCallbackEvent");
    wqDelay.bind(function () {   // one-time Preview probe: does WorldQuery return real hits here?
        if (!wqSession) { return; }
        try {
            wqSession.hitTest(new vec3(0, 0, 0), new vec3(0, -50, -100), function (r) { wqStatus = r && r.position ? "hits" : "no hits in Preview"; print("RULESHIFT WorldQuery Preview probe: " + wqStatus); });
        } catch (e) { wqStatus = "probe error: " + e; print("RULESHIFT WorldQuery Preview probe: " + wqStatus); }
    });
    wqDelay.reset(2);
});

// ---------- Stage: a thin glowing disc under the world = placement surface and world bounds ----------
(function () {
    var SEG = 64;
    function ring(r0, r1) {
        var T = [], i;
        for (i = 0; i < SEG; i++) {
            var a0 = i / SEG * Math.PI * 2, a1 = (i + 1) / SEG * Math.PI * 2;
            var o0 = [Math.cos(a0) * r1, 0, Math.sin(a0) * r1], o1 = [Math.cos(a1) * r1, 0, Math.sin(a1) * r1];
            var i0 = [Math.cos(a0) * r0, 0, Math.sin(a0) * r0], i1 = [Math.cos(a1) * r0, 0, Math.sin(a1) * r0];
            if (r0 <= 0) { tri(T, [0, 0, 0], o1, o0, [0, -1, 0]); } else { tri(T, i0, o1, o0, [0, -1, 0]); tri(T, i0, i1, o1, [0, -1, 0]); }
        }
        return buildMesh(T);
    }
    var layers = [   // [inner, outer, brightness]: stacked additive layers give a soft falloff towards a brighter rim
        [0, 1.0, 0.11], [0, 0.82, 0.10], [0, 0.6, 0.10], [0, 0.35, 0.08], [0.66, 0.675, 0.22], [0.33, 0.345, 0.22], [0.955, 1.0, 0.6], [0.9, 1.0, 0.2]
    ];
    layers.forEach(function (L, li) {
        var o = global.scene.createSceneObject("Stage " + li);
        var v = o.createComponent("Component.RenderMeshVisual");
        v.mesh = ring(L[0], 1); v.mainMaterial = SPHERE_MAT.clone();
        var p = v.mainPass; p.blendMode = BlendMode.Add; p.depthWrite = false;
        p.baseColor = new vec4(0.35 * L[2], 0.7 * L[2], 1.0 * L[2], L[2]);
        v.setRenderOrder(-40 + li);   // far behind the toolbar plates (-8..-5) so the rim never draws over the buttons
        o.getTransform().setWorldPosition(new vec3(0, TABLE_Y, WORLD_Z));
        o.getTransform().setLocalScale(vec3.one().uniformScale(STAGE_R));
    });
})();
script.api.view = function () {   // visible half-extents (cm) at the world's depth, for placing UI at the edges
    var c = script.camera, hh = Math.tan(c.fov / 2) * Math.abs(WORLD_Z);
    return { halfW: hh * c.aspect, halfH: hh, stageR: STAGE_R };
};

// ---------- Voice: transcript -> palette parameters (keyword parser; ASR itself lives in RuleShiftControls) ----------
var VOICE_WORDS = {
    shape: { sphere: ["ball", "orb", "sphere", "globe", "bubble", "circle"], cube: ["cube", "box", "block", "square", "dice"], crystal: ["crystal", "gem", "diamond", "jewel", "gemstone", "shard"],
        cone: ["cone", "pyramid", "spike", "triangle"], torus: ["ring", "donut", "doughnut", "torus", "bagel", "hoop", "loop"] },
    color: [["pink", "red", "magenta", "rose", "crimson", "ruby", "scarlet", "fuchsia"], ["cyan", "blue", "teal", "turquoise", "aqua", "sky", "azure", "navy"], ["yellow", "gold", "golden", "lemon", "amber"],
        ["green", "lime", "emerald", "mint", "olive"], ["orange", "tangerine", "peach", "coral", "copper"], ["purple", "violet", "lavender", "indigo", "lilac", "plum"]],
    size: { S: ["small", "tiny", "little", "mini", "teeny", "petite"], M: ["medium", "regular", "normal", "mid"], L: ["big", "large", "huge", "giant", "massive", "enormous", "jumbo"] },
    glowOn: ["glowing", "glow", "glows", "bright", "shiny", "luminous", "radiant", "shining", "neon", "sparkling"],
    glowOff: ["plain", "matte", "dull", "unlit"],
    weight: { heavy: ["heavy", "weighty", "dense"], light: ["light", "lightweight", "feathery", "floaty", "airy"] },
    bounce: { high: ["bouncy", "bounce", "bounces", "bouncing", "springy", "rubbery", "elastic"], low: ["flat", "dead", "stiff"] }
};
// returns { found: bool (a shape word was heard), shape, color (palette index), sizeKey, glow, weight, bounce } - missing parameters are null
function parseVoice(text) {
    var words = String(text || "").toLowerCase().replace(/[^a-z\s-]/g, " ").replace(/-/g, " ").split(/\s+/).filter(function (w) { return w.length > 0; });
    var out = { found: false, shape: null, color: null, sizeKey: null, glow: null, weight: null, bounce: null };
    function match(list, w) { return list.indexOf(w) >= 0 || (w.length > 3 && w.charAt(w.length - 1) === "s" && list.indexOf(w.slice(0, -1)) >= 0); }
    function isColor(w) { for (var q = 0; q < VOICE_WORDS.color.length; q++) { if (match(VOICE_WORDS.color[q], w)) { return true; } } return false; }
    words.forEach(function (w, wi) {
        var k;
        var lightShade = (w === "light" && wi + 1 < words.length && isColor(words[wi + 1]));   // "light blue": a shade, not the weight
        if (out.shape === null) { for (k in VOICE_WORDS.shape) { if (match(VOICE_WORDS.shape[k], w)) { out.shape = k; break; } } }
        if (out.color === null) { for (var ci = 0; ci < VOICE_WORDS.color.length; ci++) { if (match(VOICE_WORDS.color[ci], w)) { out.color = ci; break; } } }
        if (out.sizeKey === null) { for (k in VOICE_WORDS.size) { if (match(VOICE_WORDS.size[k], w)) { out.sizeKey = k; break; } } }
        if (out.glow === null) { if (match(VOICE_WORDS.glowOn, w)) { out.glow = true; } else if (match(VOICE_WORDS.glowOff, w)) { out.glow = false; } }
        if (out.weight === null && !lightShade) { for (k in VOICE_WORDS.weight) { if (match(VOICE_WORDS.weight[k], w)) { out.weight = k; break; } } }
        if (out.bounce === null) { for (k in VOICE_WORDS.bounce) { if (match(VOICE_WORDS.bounce[k], w)) { out.bounce = k; break; } } }
    });
    out.found = out.shape !== null;
    return out;
}
script.api.parseVoice = parseVoice;

// ---------- Imagine: a text prompt -> Snap3D model ----------
// imagine(prompt) spawns a normal node (a pulsing placeholder orb with an "Imagining '<prompt>'..." caption). The injected
// generator (setGenerator) later delivers a glTF asset; the orb's visuals are then swapped for the model while the node
// keeps all behaviour (drag, link, rules, physics). On failure, or after the timeout, the orb simply stays.
var IMAGINE_SIZE = 18;                                   // node footprint in cm: 1.5x the old 12 (radius 9 still fits the stage box; collisions use the same radius)
var GROW_START = 0.65, GROW_TAU = 20;                    // the pending orb starts at 65% and slowly grows towards full size (time constant in s)
var IMAGINE_COLOR = new vec4(0.7, 0.55, 1.0, 1);
var IMAGINE_TIMEOUT = 120;                               // seconds
var FAIL_CAPTION_SECS = 4;
var CAPTION_FAIL = "Couldn't imagine that — here's an orb";
var imagineTimeout = IMAGINE_TIMEOUT;
var imagineGen = null;     // function (prompt, {onSuccess(gltfAsset), onFail(reason)}) -> optional cancel function
var imagineJobs = [];      // {n, prompt, t0, state: "pending"|"ok"|"failed", result, cap, capUntil, cancel, reason}

function cleanPrompt(text) {
    var s = String(text || "").replace(/\s+/g, " ").trim();
    s = s.replace(/^(please\s+)?((can|could) you\s+)?(make|create|add|generate|imagine|give|show|build|spawn)( me| us)?\s+/i, "");
    s = s.replace(/[.!?,;:\s]+$/, "");
    return s;
}
function setLayerRec(o, layer) {
    o.layer = layer;
    for (var i = 0; i < o.getChildrenCount(); i++) { setLayerRec(o.getChild(i), layer); }
}
function collectMeshes(o, out) {
    o.getComponents("Component.RenderMeshVisual").forEach(function (v) { out.push(v); });
    for (var i = 0; i < o.getChildrenCount(); i++) { collectMeshes(o.getChild(i), out); }
}
function worldBounds(root) {   // axis-aligned world bounds of every mesh under root; null when there is no geometry
    var meshes = []; collectMeshes(root, meshes);
    var mn = null, mx = null;
    meshes.forEach(function (v) {
        if (!v.mesh) { return; }
        var M = v.getTransform().getWorldTransform(), a = v.mesh.aabbMin, b = v.mesh.aabbMax;
        for (var i = 0; i < 8; i++) {
            var p = M.multiplyPoint(new vec3(i & 1 ? b.x : a.x, i & 2 ? b.y : a.y, i & 4 ? b.z : a.z));
            if (!mn) { mn = new vec3(p.x, p.y, p.z); mx = new vec3(p.x, p.y, p.z); }
            else { mn = new vec3(Math.min(mn.x, p.x), Math.min(mn.y, p.y), Math.min(mn.z, p.z)); mx = new vec3(Math.max(mx.x, p.x), Math.max(mx.y, p.y), Math.max(mx.z, p.z)); }
        }
    });
    if (!mn) { return null; }
    var c = mn.add(mx).uniformScale(0.5);
    return { min: mn, max: mx, center: c, radius: mx.sub(mn).length * 0.5 };
}
function imagineMaterial() {   // a real material is always passed to tryInstantiate (null crashes Lens Studio)
    return (script.imagineMaterial || SPHERE_MAT).clone();
}
function finishCaption(job, text, secs) {
    if (!job.cap) { return; }
    if (text === null) { job.cap.obj.destroy(); job.cap = null; return; }
    job.cap.text.text = text; job.capUntil = elapsed + secs;
}
function failJob(job, reason) {
    if (job.state !== "pending") { return; }
    job.state = "failed"; job.reason = reason;
    if (job.cancel) { try { job.cancel(); } catch (e) { } }
    finishCaption(job, CAPTION_FAIL, FAIL_CAPTION_SECS);
    var n = job.n; if (nodeIndex(n) >= 0) { setNodeColor(n, n.color); n.tr.setLocalScale(n.baseScale); }
    print("RULESHIFT imagine FAILED '" + job.prompt + "' (" + reason + ") after " + (elapsed - job.t0).toFixed(1) + "s - keeping the orb");
}
function restyleSaved(root) {   // a saved prefab keeps its imported (translucent) materials: give every mesh the same opaque material a generated model gets, keeping its texture
    var meshes = []; collectMeshes(root, meshes);
    meshes.forEach(function (v) {
        var old = v.mainMaterial, nm = imagineMaterial();
        try { var tex = old.mainPass.baseColorTexture || old.mainPass.baseTex; if (tex) { nm.mainPass.baseTex = tex; } } catch (e) { }
        v.mainMaterial = nm;
    });
}
function swapInModel(job, gltf) {
    var n = job.n;
    var holder = global.scene.createSceneObject("Imagined Model");
    holder.setParent(n.obj);
    holder.getTransform().setLocalPosition(vec3.zero());
    holder.getTransform().setLocalScale(vec3.one());
    var model = gltf.tryInstantiate ? gltf.tryInstantiate(holder, imagineMaterial()) : gltf.instantiate(holder);   // a live glTF asset (Snap3D) or a saved model (ObjectPrefab)
    if (!model) { holder.destroy(); throw new Error("tryInstantiate returned null"); }
    if (!gltf.tryInstantiate) { restyleSaved(holder); }
    setLayerRec(holder, n.obj.layer);
    var gk = n.growK; n.growK = 1; applyGrow(n);           // the placeholder was still growing: the model gets the full hero size; measure at the resting (ungrown) scale
    var b = worldBounds(holder);
    if (!b || b.radius < 1e-5) { holder.destroy(); throw new Error("model has no geometry"); }
    // fit: scale the model so its bounding sphere matches the orb footprint, and centre it on the node
    var nodeW = n.tr.getWorldPosition(), ht = holder.getTransform();
    var f = (n.size * 0.5) / (b.radius * 1.0), off = b.center.sub(nodeW);
    ht.setLocalScale(vec3.one().uniformScale(f));
    ht.setWorldPosition(nodeW.sub(off.uniformScale(f)));
    var b2 = worldBounds(holder);
    n.mBase = { p: ht.getLocalPosition(), r: ht.getLocalRotation(), s: ht.getLocalScale() };   // procedural life animates around this
    // collider sized from the fitted bounds (sphere radius is in node-local units)
    var col = n.obj.getComponent("Component.ColliderComponent");
    if (col && col.shape && col.shape.radius !== undefined) { var sh = col.shape; sh.radius = Math.max(0.3, Math.min(0.75, b2.radius / n.size)); col.shape = sh; }
    n.growK = gk; applyGrow(n);                            // a Grow rule may already have enlarged the node
    n.rmv.enabled = false;
    n.glow.forEach(function (o) { o.enabled = false; });
    if (n.shine) { n.shine.enabled = false; }   // the orb's specular blob must not linger on the model
    n.glowOn = false; n.parts = []; n.modelRoot = holder; n.imagined = true;
    job.bounds = { before: b.radius, after: b2.radius, scale: f };
    job.state = "ok";
    finishCaption(job, null);
    print("RULESHIFT imagine OK '" + job.prompt + "' in " + (elapsed - job.t0).toFixed(1) + "s (fit scale " + f.toFixed(4) + ", radius " + b2.radius.toFixed(2) + ")");
}
// Captions sit above the topmost object on the stage (never at the node), stacked when several show at once.
var CAP_MARGIN = 4, CAP_STEP = 4.5, CAP_MAX_Y = 22;
function captionY(slot) {
    var top = BOX_YMAX;
    nodes.forEach(function (n) { top = Math.max(top, n.pos.y + n.radius); });
    return Math.min(top + CAP_MARGIN, CAP_MAX_Y - 0) + (slot || 0) * CAP_STEP;
}
function capSlot(job) { var k = 0; for (var i = 0; i < imagineJobs.length; i++) { if (imagineJobs[i] === job) { return k; } if (imagineJobs[i].cap) { k++; } } return k; }
function styleCaption(t) {   // readable on any background: dark outline
    t.outlineSettings.enabled = true; t.outlineSettings.size = 0.5; t.outlineSettings.fill.color = new vec4(0.05, 0.03, 0.2, 1);
}
function imagine(prompt) {
    prompt = cleanPrompt(prompt) || String(prompt || "").trim();
    var n = spawnNode({ shape: "sphere", color: IMAGINE_COLOR, glow: true, size: IMAGINE_SIZE, name: "Imagined: " + prompt });
    if (!n) { return -1; }
    if (pendingPlace === n) { pendingPlace = null; }   // it appears at a free spot: nothing waits for a pinch, so no placement hint
    var cap = makeText("Imagine Caption", 60, new vec3(0, captionY(0), WORLD_Z), new vec4(0.85, 0.95, 1, 1));
    styleCaption(cap.text);
    cap.text.text = "Imagining '" + prompt + "'… 0s"; cap.text.renderOrder = 100;
    var job = { n: n, prompt: prompt, t0: elapsed, state: "pending", result: null, cap: cap, capUntil: 0, cancel: null, reason: "", timeout: imagineTimeout };
    imagineJobs.push(job);
    n.job = job;
    print("RULESHIFT imagine START '" + prompt + "' (timeout " + job.timeout + "s)");
    if (!imagineGen) { job.result = { ok: false, reason: "no generator installed" }; return nodeIndex(n); }
    try {
        job.cancel = imagineGen(prompt, {
            onSuccess: function (g) { if (job.state === "pending" && !job.result) { job.result = { ok: true, asset: g }; } },
            onFail: function (why) { if (job.state === "pending" && !job.result) { job.result = { ok: false, reason: String(why) }; } }
        }) || null;
    } catch (e) { job.result = { ok: false, reason: "generator threw: " + e }; }
    return nodeIndex(n);
}
function updateImagine(dt) {
    for (var i = imagineJobs.length - 1; i >= 0; i--) {
        var job = imagineJobs[i], n = job.n, alive = nodeIndex(n) >= 0;
        if (!alive) {   // the user deleted the object: cancel the job and drop the caption
            if (job.state === "pending") { job.state = "cancelled"; if (job.cancel) { try { job.cancel(); } catch (e) { } } }
            if (job.cap) { job.cap.obj.destroy(); job.cap = null; }
            imagineJobs.splice(i, 1); continue;
        }
        if (job.state === "pending") {
            if (job.result) {   // results are applied here, on the update loop, never inside the generator's callback
                var r = job.result; job.result = null;
                if (r.ok) { try { swapInModel(job, r.asset); } catch (e) { failJob(job, "swap failed: " + e); } }
                else { failJob(job, r.reason); }
            } else if (elapsed - job.t0 >= job.timeout) {
                failJob(job, "timeout after " + job.timeout + "s");
            }
        }
        if (job.state === "pending") {   // alive placeholder: slow growth, gentle pulse, seconds counter (growth/pulse yield to selection and collision pulses)
            var age = elapsed - job.t0, g = 1 - (1 - GROW_START) * Math.exp(-age / GROW_TAU);
            n.baseScale = vec3.one().uniformScale(n.size * g * n.growK); n.radius = n.size * 0.5 * g * n.growK;
            var k = 0.5 + 0.5 * Math.sin(age * 4);
            if (n.pulse < 0 && n !== selNode && !n.selShown) {
                n.tr.setLocalScale(n.baseScale.uniformScale(0.96 + 0.08 * k));
                setNodeColor(n, lerp4(n.color, new vec4(1, 1, 1, 1), 0.45 * k));
            }
            var secs = Math.floor(age);
            if (job.cap && secs !== job.lastSecs) { job.lastSecs = secs; job.cap.text.text = "Imagining '" + job.prompt + "'… " + secs + "s"; }
        }
        if (job.cap) {
            job.cap.tr.setWorldPosition(new vec3(0, captionY(capSlot(job)), WORLD_Z));
            if (job.state === "failed" && elapsed >= job.capUntil) { finishCaption(job, null); }
        }
        if (job.state !== "pending" && !job.cap) { imagineJobs.splice(i, 1); }
    }
}
// Saved models (imported .glb prefabs) become normal nodes instantly: the same swap-in as a generated model, no generator or wait.
function spawnModelNode(asset, name, size, weight, pos, fallbackColor) {
    var n = spawnNode({ shape: "sphere", color: fallbackColor, size: size, weight: weight, pos: pos, name: name });
    if (!n) { return null; }
    if (!asset) { print("RULESHIFT model missing for " + name + " - keeping the orb"); return n; }
    try { swapInModel({ n: n, prompt: name, t0: elapsed, state: "pending", cap: null }, asset); }
    catch (e) { print("RULESHIFT model swap failed for " + name + ": " + e); }
    return n;
}
script.api.captionY = captionY;
script.api.captionCount = function () { return imagineJobs.filter(function (j) { return !!j.cap; }).length; };
script.api.cleanPrompt = cleanPrompt;
script.api.setGenerator = function (fn) { imagineGen = fn; };
script.api.imagine = imagine;
script.api.imagineTimeout = function (sec) { if (sec !== undefined) { imagineTimeout = sec; } return imagineTimeout; };
script.api.imagineJobs = imagineJobs;
script.api.test.imagineState = function (i) { var n = nodes[i]; return n && n.job ? n.job.state : "none"; };
