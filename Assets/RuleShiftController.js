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
// @input SceneObject embersVfx
// @input SceneObject sparklesVfx
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
var WORLD_Z = -95;                             // the UI plane (toolbar, rule editor, card, hints) and the depth the legacy presets were laid out at
// ---------- World scale ----------
// Every distance, speed and size below is written for the original 46 cm stage (K = 1) and multiplied by K. The Lens runs at ROOM_K, where the world is the
// user's room: the same equations scaled by K, so motion keeps its timing but covers room distances (hero objects 20-40 cm, links up to ~2 m).
// K = 1 (the legacy stage scale, with its stage-sized box) is kept only so the original regression suite can still run unchanged: api.test.setWorldScale(1).
var ROOM_K = 2.4, K = ROOM_K;
function roomMode() { return K !== 1; }
// Room geometry (cm, the camera sits at the origin looking down -z). Measured in the Preview's Sunlit Room by camera parallax: eye height is about 1.5 m, so the floor is at y = -150
// (+-15 cm); the room's real tables are beyond the 2 m range (the coffee table is ~3.2 m away, the credenza ~4.4 m). The "table" fallback is therefore a virtual 75 cm table
// plane within reach (y = -75); on a device WorldQuery finds the real surfaces first and these are only the fallback. The legacy stage kept its by-eye table height (-19).
var TABLE_Y_STAGE = -19, TABLE_Y_ROOM = -37.5, FLOOR_Y = TABLE_Y_ROOM, SIDEBOARD_TOP = -0.277;   // room: the virtual table is the top of the real sideboard in the Sunlit Room Preview, 37.5 cm below eye level at 1.25 m (its back edge sits at angular -0.277, a thin strip down to the bottom of the view); SIDEBOARD_TOP keeps floating panels above it. Old note: 24 cm below eye level (Preview has no real table within 2 m) and is also the floor of the play volume, so everything stays in the default view above the toolbar
function tableY() { return roomMode() ? TABLE_Y_ROOM : TABLE_Y_STAGE; }
var TABLE_RECT = { x: 40, zNear: -95, zFar: -150 };   // where the table fallback applies; a ray landing outside it continues to the floor
var ROOM = { x: 36, yMax: 42, zNear: -116, zFar: -145 };   // the play volume, 1.1-1.45 m in front of the user: x half-width 36 cm is exactly the default Preview view at 1.25 m, so nothing can leave the screen; floor = FLOOR_Y (the table), ceiling yMax
var SIZES = { S: 7, M: 10, L: 14 };            // node scale in cm at K = 1 (diameter of the bounding sphere); spawnNode multiplies by K
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
function spawnPlane() { return roomMode() ? -125 : WORLD_Z; }   // depth where new objects appear (1.3 m in the room: inside arm's reach of the layout, in front of the table)
function spotBox(radius) {   // the region new objects are offered: the legacy stage box, or the comfortable part of the room in front of the user
    if (!roomMode()) { return { x0: -BOX_X + radius, x1: BOX_X - radius, y0: BOX_YMIN + radius, y1: BOX_YMAX - radius, step: 0.5, cy: -2 }; }
    return { x0: -ROOM.x + radius, x1: ROOM.x - radius, y0: FLOOR_Y + radius, y1: ROOM.yMax - radius, step: 2, cy: 8 };
}
function findFreeSpot(radius) {
    var b = spotBox(radius), z0 = spawnPlane(), cy = b.cy, sk = roomMode() ? K : 1;
    var best = new vec3(0, cy, z0);
    for (var k = 0; k < (nodes.length < 3 ? 60 : 0); k++) {   // spiral keeps the first few near the centre; later ones are packed on a grid
        var ang = k * 2.39996, rad = (k === 0 ? 0 : 3 + k * 0.45) * sk;
        var p = new vec3(Math.cos(ang) * rad * 1.1, cy + Math.sin(ang) * rad * 0.7, z0);
        p = new vec3(Math.max(b.x0, Math.min(b.x1, p.x)), Math.max(b.y0, Math.min(b.y1, p.y)), z0);
        var free = nodes.every(function (n) { return n.pos.distance(p) >= n.radius + radius + 0.5 * sk; });
        if (free) { return p; }
        best = p;
    }
    // spiral found nothing: scan the whole region on a fine grid for any free spot
    for (var gy = b.y0; gy <= b.y1 + 0.001; gy += b.step) {
        for (var gx = b.x0; gx <= b.x1 + 0.001; gx += b.step) {
            var q = new vec3(gx, gy, z0);
            if (nodes.every(function (n) { return n.pos.distance(q) >= n.radius + radius + 0.1 * sk; })) { return q; }
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
    var size = opts.size || SIZES[opts.sizeKey || "M"] * K;
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
    var p = opts.pos ? new vec3(opts.pos.x, opts.pos.y, opts.pos.z === undefined ? spawnPlane() : opts.pos.z) : findFreeSpot(radius);
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
    if (selNode === n) { selNode = null; connectArmed = false; }
    if (pendingPlace === n) { pendingPlace = null; }
    nodes.splice(i, 1);
    if (n.extra) { n.extra.forEach(function (o) { o.destroy(); }); }
    n.obj.destroy();
    refreshConnections(); updateEmptyHint();
    print("RULESHIFT deleted " + nm + " (" + nodes.length + " left)");
    return true;
}

// ---------- Placement: a pinch on a surface puts the newest object there ----------
// Surfaces: a virtual table plane (always available), with WorldQuery tried first when it returns hits.
// (TABLE_Y / FLOOR_Y / TABLE_RECT are declared with the room geometry at the top; WorldQuery returns no hits in Preview, so those are the fallback surfaces.)
var pendingPlace = null;        // the newest spawned object waits for a pinch to be placed
var hintObj = null, hintText = null;
(function () {
    var h = makeText("Place Hint", 80, new vec3(0, 26, WORLD_Z), new vec4(0.75, 1, 0.85, 1));
    hintObj = h.obj; hintText = h.text; hintText.text = "Pinch a surface to place it"; hintObj.enabled = false;
})();
var emptyHint = null;
(function () {
    emptyHint = makeText("Empty Hint", 85, new vec3(0, 2, WORLD_Z), new vec4(0.85, 0.95, 1, 1)).obj;
    emptyHint.getComponent("Component.Text").text = "Create something to begin";
})();
// The one first-time hint: shown on an empty stage until the first object exists, then never again (a preset stage never shows it).
var firstHintDone = !!script.demoPreset || !!script.demoStage, firstHintOn = true;
function updateEmptyHint() {
    if (nodes.length > 0) { firstHintDone = true; }
    if (emptyHint) { emptyHint.enabled = firstHintOn && !firstHintDone && nodes.length === 0; }
}
script.api.firstHintVisible = function () { return !!emptyHint && emptyHint.enabled; };
script.api.setFirstHint = function (on) { firstHintOn = !!on; if (on) { firstHintDone = false; } updateEmptyHint(); };
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
var lastSurface = null;   // which fallback surface the last ray used ("plane" at K = 1, else "table" or "floor")
function planeHit(o, d) {   // the table plane (legacy) or, in the room, the table when the ray lands on it and the floor otherwise; looking at or above the horizon never hits
    if (d.y > -0.001) { return null; }
    var t = (tableY() - o.y) / d.y, p = o.add(d.uniformScale(t));
    if (!roomMode()) { lastSurface = "plane"; return p; }
    if (Math.abs(p.x) <= TABLE_RECT.x && p.z <= TABLE_RECT.zNear && p.z >= TABLE_RECT.zFar) { lastSurface = "table"; return p; }
    var tf = (FLOOR_Y - o.y) / d.y;
    lastSurface = "floor";
    return o.add(d.uniformScale(tf));
}
function worldDepthHit(o, d) {   // fallback: where the ray crosses the world's depth plane
    var t = (spawnPlane() - o.z) / (Math.abs(d.z) > 0.001 ? d.z : -0.001);
    return o.add(d.uniformScale(Math.max(t, 1)));
}
function placeNodeAt(n, hit, via) {
    var p;
    if (roomMode()) {   // an object rests ON the surface it was placed on (centre one radius above it), anywhere inside the room volume
        var onSurf = via === "plane" || via === "table" || via === "floor" || via === "worldquery";
        p = clampToBox(n, new vec3(hit.x, onSurf ? hit.y + n.radius : hit.y, hit.z));
    } else {
        var onTable = via === "plane";
        var lx = Math.min(BOX_X, STAGE_R - n.radius);
        p = new vec3(Math.max(-lx, Math.min(lx, hit.x)),
            onTable ? tableY() + n.radius : hit.y,
            Math.max(WORLD_Z - BOX_Z, Math.min(WORLD_Z + BOX_Z, hit.z)));
        p = new vec3(p.x, Math.max(BOX_YMIN, Math.min(BOX_YMAX, p.y)), p.z);
    }
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
    if (hit) { var via = lastSurface || "plane"; placeNodeAt(n, hit, via); return via; }
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
    var editorWas = !!editorLink;
    if (editorLink && script.camera) { var a = screenToAng(sp); editorTouch(a.x, a.y); }
    if (placeAtScreen(sp) === null && !editorWas) { realPinchAtScreen(sp); }
});

// ---------- Real-object nodes: pinch a real object in the room, name it from a short list, and it becomes an immovable node ----------
// The node has no model: a soft glowing ring hugging the real object and a small name tag. It links and obeys every rule like any node, but never moves.
var REAL_TYPES = [{ name: "Lamp", size: 16 }, { name: "Table", size: 40 }, { name: "Plant", size: 16 }, { name: "Speaker", size: 10 }, { name: "Turntable", size: 15 }, { name: "Chair", size: 30 }];   // default collision size (cm, diameter)
var REAL_COLOR = new vec4(0.35, 1.0, 0.85, 1);
var REAL_RING = [[0.475, 0.525, 0.72], [0.43, 0.57, 0.3], [0.35, 0.65, 0.12]];   // inner radius, outer radius (node-local, 0.5 = the collision radius), alpha: three nested additive annuli read as one soft ring
var realMenu = null, realMenuSeq = 0, uiBusyProbe = null, ringMeshCache = {};
function screenRay(sp) {
    var cam = script.camera, o = cam.getTransform().getWorldPosition();
    var w = cam.screenSpaceToWorldSpace(sp, 100);
    var d = w.sub(o); d = d.uniformScale(1 / Math.max(d.length, 0.0001));
    return { o: o, d: d };
}
function rayBlocked(o, d) {
    var blocked = false;
    try {
        probe = probe || Physics.createGlobalProbe();
        probe.rayCast(o, o.add(d.uniformScale(400)), function (hit) { if (hit && hit.collider) { blocked = true; } });
    } catch (e) { }
    return blocked;
}
function openRealMenu(o, d) {   // a ray from the eye through the pinch: the point is where it crosses the room's depth plane (the sideboard objects stand there); on a device a WorldQuery hit replaces it
    var t = (spawnPlane() - o.z) / (Math.abs(d.z) > 0.001 ? d.z : -0.001);
    var pos = o.add(d.uniformScale(Math.max(t, 1)));
    var dep = Math.max(-pos.z, 1);
    var m = { pos: pos, ax: pos.x / dep, ay: pos.y / dep, id: ++realMenuSeq };
    realMenu = m;
    if (selNode) { selNode = null; connectArmed = false; }
    if (wqSession) {
        try { wqSession.hitTest(o, o.add(d.uniformScale(400)), function (r) { if (realMenu === m && r && r.position) { m.pos = new vec3(r.position.x, r.position.y, r.position.z); wqStatus = "hits"; } }); } catch (e) { }
    }
    if (visionProvider) {   // vision: name the object from a camera crop; the list only appears if that fails or takes over 12 s
        m.looking = true; m.deadline = elapsed + VISION_LIMIT;
        visionProvider(m.ax, m.ay, function (name, info) {
            if (realMenu !== m || !m.looking) { return; }
            script.api.visionLast = info || null;
            if (name) { realMenu = null; spawnNamedReal(name, m.pos); } else { m.looking = false; print("RULESHIFT vision failed (" + (info && info.why) + "): showing the list"); }
        });
    }
    print("RULESHIFT real-object list opened at (" + pos.x.toFixed(1) + ", " + pos.y.toFixed(1) + ", " + pos.z.toFixed(1) + ")");
}
function realPinchAtScreen(sp) {   // a press on empty space (no object, button or link under it): opens the name list; a press elsewhere while it is open closes it
    if (!script.camera) { return null; }
    var r = screenRay(sp);
    if (rayBlocked(r.o, r.d)) { return "blocked"; }
    if (realMenu) { realMenu = null; return "cancelled"; }
    if (pendingPlace || connectArmed || (uiBusyProbe && uiBusyProbe())) { return null; }
    openRealMenu(r.o, r.d);
    return "menu";
}
function ringMesh(r0, r1) {
    var key = r0 + "_" + r1;
    if (ringMeshCache[key]) { return ringMeshCache[key]; }
    var N = 48, tris = [], P = function (r, a) { return [Math.cos(a) * r, Math.sin(a) * r, 0]; };
    for (var i = 0; i < N; i++) {
        var a0 = 2 * Math.PI * i / N, a1 = 2 * Math.PI * (i + 1) / N;
        var a = P(r0, a0), b = P(r1, a0), c = P(r1, a1), d = P(r0, a1);
        tris.push([a, b, c], [a, c, d], [a, c, b], [a, d, c]);   // both windings: visible from either side
    }
    return (ringMeshCache[key] = buildMesh(tris));
}
function spawnRealNode(name, size, pos) {
    var n = spawnNode({ shape: "sphere", size: size, color: REAL_COLOR, pos: pos, name: name, shine: false });
    if (!n) { return null; }
    n.anchored = true; n.real = true; n.rest = 0;
    n.parts.forEach(function (pt) { pt.rmv.enabled = false; });   // no model; the collider stays so the node can be tapped, linked and removed
    n.rings = [];
    REAL_RING.forEach(function (L, i) {
        var o = global.scene.createSceneObject("Ring " + i);
        o.setParent(n.obj); o.layer = n.obj.layer;
        var v = o.createComponent("Component.RenderMeshVisual");
        v.mesh = ringMesh(L[0], L[1]); v.mainMaterial = SPHERE_MAT.clone();
        v.mainPass.blendMode = BlendMode.Add; v.mainPass.depthWrite = false; v.setRenderOrder(-2 + i);
        n.rings.push({ pass: v.mainPass, a: L[2], obj: o });
    });
    var tag = makeText("Tag " + name, 72, pos, new vec4(0.85, 1, 0.95, 1));
    styleCaption(tag.text);
    tag.text.text = name;
    n.tag = tag; n.extra = [tag.obj];
    updateRealVisuals();
    print("RULESHIFT real object '" + name + "' anchored at (" + pos.x.toFixed(1) + ", " + pos.y.toFixed(1) + ", " + pos.z.toFixed(1) + "), size " + size);
    return n;
}
function spawnNamedReal(name, pos) {   // a name from vision: a known type keeps its default size, anything else gets a middling one
    var size = 14;
    for (var i = 0; i < REAL_TYPES.length; i++) { if (REAL_TYPES[i].name.toLowerCase() === name.toLowerCase()) { size = REAL_TYPES[i].size; name = REAL_TYPES[i].name; } }
    return spawnRealNode(name, size, pos);
}
var visionProvider = null;
var VISION_LIMIT = 12;   // seconds the camera naming may take before the list appears
script.api.setVisionProvider = function (f) { visionProvider = f; };
script.api.getVisionProvider = function () { return visionProvider; };
function updateRealVisuals() {
    if (realMenu && realMenu.looking && elapsed > realMenu.deadline) { realMenu.looking = false; print("RULESHIFT vision timed out after " + VISION_LIMIT + " s: showing the list"); }
    for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (!n.real) { continue; }
        var k = 0.88 + 0.12 * Math.sin(elapsed * 2.4 + i);   // a slow breathing glow
        var sel = n === selNode ? 1.5 : 1;
        n.rings.forEach(function (R) { var a = Math.min(1, R.a * k * sel); R.pass.baseColor = new vec4(REAL_COLOR.r * a, REAL_COLOR.g * a, REAL_COLOR.b * a, a); });
        var s = Math.max(1, -n.pos.z / -WORLD_Z);
        // the ring (and the beam end) shift just enough to keep the whole ring inside the visible view: an object at the edge of the view (the turntable on the
        // sideboard's front edge) gets a ring that hugs its visible part instead of a clipped circle. The collision circle itself stays where the object is.
        var vw = script.api.view(), dep = Math.max(-n.pos.z, 1), limX = vw.halfW / -WORLD_Z * 0.97, limY = vw.halfH / -WORLD_Z * 0.97, rA = n.radius * 1.15 / dep;
        var ax = n.pos.x / dep, ay = n.pos.y / dep, dx = 0, dy = 0;
        if (ax - rA < -limX) { dx = (-limX + rA - ax) * dep; } else if (ax + rA > limX) { dx = (limX - rA - ax) * dep; }
        if (ay - rA < -limY) { dy = (-limY + rA - ay) * dep; } else if (ay + rA > limY) { dy = (limY - rA - ay) * dep; }
        var ls = Math.max(n.size * n.growK, 0.001);
        n.rings.forEach(function (R) { R.obj.getTransform().setLocalPosition(new vec3(dx / ls, dy / ls, 0)); });
        n.vOff = new vec3(dx / n.growK, dy / n.growK, 0);
        n.ringBox = { x0: (n.pos.x + dx) / dep - rA, x1: (n.pos.x + dx) / dep + rA, y0: (n.pos.y + dy) / dep - rA, y1: (n.pos.y + dy) / dep + rA };
        n.tag.tr.setWorldScale(vec3.one().uniformScale(s));
        var tagY = n.pos.y + dy + n.radius * 1.15 + 3.0 * s;
        if (roomMode() && n.pos.y - n.radius < FLOOR_Y + 3) { tagY = Math.max(tagY, FLOOR_Y + 24); }   // an object standing on the surface: the name rides above head height of whatever stands beside it (the 22 cm cat)
        n.tag.tr.setWorldPosition(new vec3(n.pos.x + dx, tagY, n.pos.z + 2));
    }
}
script.api.setUiBusyProbe = function (f) { uiBusyProbe = f; };
script.api.realTypes = function () { return REAL_TYPES.map(function (t) { return t.name; }); };
script.api.realMenuInfo = function () { return realMenu ? { x: realMenu.ax, y: realMenu.ay, z: realMenu.pos.z, id: realMenu.id, looking: !!realMenu.looking } : null; };
script.api.closeRealMenu = function () { realMenu = null; };
script.api.chooseReal = function (name) {   // a list entry picked (anything else, e.g. Cancel, just closes the list)
    var m = realMenu; realMenu = null;
    if (!m) { return null; }
    for (var i = 0; i < REAL_TYPES.length; i++) { if (REAL_TYPES[i].name === name) { return spawnRealNode(name, REAL_TYPES[i].size, m.pos); } }
    return null;
};

// ---------- links ----------
var HALO_SCALE = 1.7;
function setBeamColor(c, col) {
    if (c.segs) { for (var i = 0; i < c.segs.length; i++) { c.segs[i].rmv.mainPass.baseColor = col; } }
    if (c.halo) { var hc = new vec4(col.r * HALO_A, col.g * HALO_A, col.b * HALO_A, HALO_A); for (var h = 0; h < c.halo.length; h++) { c.halo[h].rmv.mainPass.baseColor = hc; } }   // wide soft halo in the rule colour
}
var HALO_A = 0.34, HALO_N = 8, CORE_N = 8, BEAM_TRAIL = 3;
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
    c.halo = []; c.core = []; c.trail = [];
    for (var hi = 0; hi < HALO_N; hi++) {   // soft halo: wider, translucent, drawn under the body
        var ho = global.scene.createSceneObject("Beam Halo"); ho.setParent(root); ho.layer = root.layer;
        var hv = ho.createComponent("Component.RenderMeshVisual");
        hv.mesh = mesh; hv.mainMaterial = mat.clone();
        hv.mainPass.blendMode = BlendMode.Add; hv.mainPass.depthWrite = false; hv.setRenderOrder(3);
        c.halo.push({ o: ho, tr: ho.getTransform(), rmv: hv });
    }
    for (var ci = 0; ci < CORE_N; ci++) {   // bright white core on top of the body
        var co = global.scene.createSceneObject("Beam Core"); co.setParent(root); co.layer = root.layer;
        var cv = co.createComponent("Component.RenderMeshVisual");
        cv.mesh = mesh; cv.mainMaterial = mat.clone();
        cv.mainPass.blendMode = BlendMode.Add; cv.mainPass.depthWrite = false; cv.setRenderOrder(4);
        cv.mainPass.baseColor = new vec4(1, 1, 1, 1);
        c.core.push({ o: co, tr: co.getTransform(), rmv: cv });
    }
    for (var ti = 0; ti < BEAM_TRAIL; ti++) {   // faint sparkles drifting off the beam
        var to = global.scene.createSceneObject("Beam Trail"); to.setParent(root); to.layer = root.layer;
        var tv = to.createComponent("Component.RenderMeshVisual");
        tv.mesh = SPHERE_MESH; tv.mainMaterial = SPHERE_MAT.clone();
        tv.mainPass.blendMode = BlendMode.Add; tv.mainPass.depthWrite = false; tv.mainPass.depthTest = false; tv.setRenderOrder(5);
        c.trail.push({ o: to, tr: to.getTransform(), pass: tv.mainPass, age: ti * 0.4, life: 1.4, u: 0.5, side: 1, size: 0.5 });
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
    if (selNode === n) { selNode = null; connectArmed = false; print("RULESHIFT selection cancelled"); return; }
    var c = slotFor(selNode, n, true);
    if (!c.active) { activateLink(c, RULES.ATTRACT, false); }
    else { print("RULESHIFT already linked"); }
    selNode = null; connectArmed = false;
}
// Connect pill: arms linking from the selected object; the next object tapped is linked to it (with exactly two objects it links them straight away).
var connectArmed = false;
function connectSelected() {
    if (!selNode) { return false; }
    if (nodes.length === 2) {
        var o = nodes[0] === selNode ? nodes[1] : nodes[0], c = slotFor(selNode, o, true);
        if (!c.active) { activateLink(c, RULES.ATTRACT, false); }
        selNode = null; connectArmed = false; return true;
    }
    connectArmed = !connectArmed; return connectArmed;
}
script.api.connectSelected = connectSelected;
script.api.connectArmed = function () { return connectArmed && !!selNode; };
function pressStartNode(n) { if (pendingPlace === n) { pendingPlace = null; } n.dragging = !n.anchored; n.tapT = elapsed; n.tapP = n.tr.getLocalPosition(); }
function pressEndNode(n, allowTap) {
    if (nodeIndex(n) < 0) { return; }
    n.dragging = false; var p = n.anchored ? n.pos : n.tr.getLocalPosition(); n.pos = new vec3(p.x, p.y, p.z); n.vel = vec3.zero(); if (n.anchored) { n.tr.setLocalPosition(n.pos); }
    // only a short press that barely moved counts as a tap-select; drags never do
    if (allowTap && elapsed - n.tapT < 0.35 && p.distance(n.tapP) < 1.5 * K) { handleTapNode(n); }
}
function clearLinks() {
    clearCause();
    slots.forEach(function (c) { c.active = false; c.visual.enabled = false; c.labelObj.enabled = false; c.beamRoot.enabled = false; });
    refreshConnections();
    selNode = null; connectArmed = false;
    print("RULESHIFT links cleared");
}
var armHalo = null, armHaloPass = null;
function updateArmHalo() {   // Connect armed: a bright pulsing halo behind the selected object until the link is made or cancelled
    var on = connectArmed && !!selNode;
    if (!on) { if (armHalo) { armHalo.enabled = false; } return; }
    if (!armHalo) {
        armHalo = global.scene.createSceneObject("Connect Halo");
        var par = NODE_TMPL.getParent(); if (par) { armHalo.setParent(par); }
        armHalo.layer = NODE_TMPL.layer;
        var hv = armHalo.createComponent("Component.RenderMeshVisual");
        hv.mesh = SPHERE_MESH; hv.mainMaterial = SPHERE_MAT.clone();
        hv.mainPass.blendMode = BlendMode.Add; hv.mainPass.depthWrite = false; hv.mainPass.depthTest = false; hv.setRenderOrder(3);
        armHaloPass = hv.mainPass;
    }
    var k = 0.5 + 0.5 * Math.sin(elapsed * 6);
    armHalo.enabled = true;
    armHalo.getTransform().setLocalPosition(selNode.pos);
    armHalo.getTransform().setLocalScale(vec3.one().uniformScale(selNode.radius * 2 * (0.82 + 0.08 * k) / SPHERE_D));
    armHaloPass.baseColor = new vec4(0.04, 0.22 + 0.1 * k, 0.36 + 0.1 * k, 1);
}
function updateSelection() {
    nodes.forEach(function (n) {
        if (n.pulse >= 0) { return; }
        if (n === selNode) {
            var k = 0.5 + 0.5 * Math.sin(elapsed * 8);
            setNodeColor(n, connectArmed ? lerp4(n.color, new vec4(0.35, 0.95, 1, 1), 0.75) : lerp4(n.color, new vec4(1, 1, 1, 1), 0.55));
            n.tr.setLocalScale(n.baseScale.uniformScale((connectArmed ? 1.15 : 1.1) + (connectArmed ? 0.15 : 0.1) * k));
            n.selShown = true;
        } else if (n.selShown) {
            setNodeColor(n, n.color); n.tr.setLocalScale(n.baseScale); n.selShown = false;
        }
    });
    updateArmHalo();
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

var LINK_GAP = 6;  // visible link length when attracted (room: 6 cm, not scaled, so a compact room layout still leaves room to travel)
function gapK() { return roomMode() ? 1 : K; }
function repK() { return roomMode() ? K * 0.5 : K; }   // repel range: 48 cm in the room, so the cat flees about 20 cm and stays in view
var REPEL_RANGE = 40, DAMPING = 3.0, MAX_SPEED = 40;
function computeForces() {
    nodes.forEach(function (n) { n.force = vec3.zero(); });
    connections.forEach(function (c) {
        var A = c.A, B = c.B;
        var delta = B.pos.sub(A.pos);
        var dist = Math.max(delta.length, 0.01);
        var dir = delta.uniformScale(1 / dist);   // A -> B
        var f = 0;
        // every length, speed and force is scaled by K, so a room-scale world is an exact K-times copy of the stage dynamics (same timing, K-times the distance)
        if (c.rule === RULES.ATTRACT) {
            var rest = A.radius + B.radius + ((A.anchored || B.anchored) ? 0 : LINK_GAP * gapK());   // a real object has no model to stand off from: the other settles touching its ring
            f = dist > rest ? script.strength * 30 * K * Math.min(1, (dist - rest) / (10 * K)) : 0;
        } else if (c.rule === RULES.REPEL) {
            f = dist < REPEL_RANGE * repK() ? -script.strength * 60 * K * (1 - dist / (REPEL_RANGE * repK())) - 6 * K : 0;
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
    if (c.touching) { if (dd > touchD + REARM_GAP * K) { c.touching = false; } return false; }
    if (dd > touchD + 0.1 * K) { return false; }
    c.touching = true; c.fires = (c.fires || 0) + 1;
    return true;
}
function applyGrow(n) {   // size follows growK: visual scale, collision radius and the physics collider (node-local units) all scale together
    n.baseScale = vec3.one().uniformScale(n.size * n.growK); n.radius = n.size * 0.5 * n.growK;
    n.tr.setLocalScale(n.baseScale);
}
function growNode(n) { n.growK = Math.min(GROW_CAP, n.growK * GROW_STEP); applyGrow(n); if (n.growK >= GROW_CAP - 1e-9) { discover("growth", n.obj.name + " at max size"); } }
function transferVelocity(A, B) {   // Newton's cradle: the faster object hands most of its velocity to the slower one
    if (A.anchored || B.anchored) {   // an immovable real object takes the whole hit: the mover gives up 90% of its speed
        var mv = A.anchored ? B : A;
        if (mv.vel.length < TRANSFER_MIN_SPEED) { return false; }
        mv.vel = mv.vel.uniformScale(TRANSFER_KEEP); return true;
    }
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
        o.getTransform().setLocalScale(vec3.one().uniformScale(CAUSE_SIZES[i] * K / SPHERE_D));
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
        if (n.anchored) { n.vel = vec3.zero(); n.tr.setLocalPosition(n.pos); return; }
        if (n.dragging) { return; }
        n.vel = n.vel.add(n.force.uniformScale(dt * n.accel)).uniformScale(Math.max(0, 1 - DAMPING * dt));
        var sp = n.vel.length;
        if (sp > MAX_SPEED * K) { n.vel = n.vel.uniformScale(MAX_SPEED * K / sp); }
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
        if (n.anchored) { n.vel = vec3.zero(); n.force = vec3.zero(); n.tr.setLocalPosition(n.pos); return; }   // the Interactable may try to drag it: put it back
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
var toolbarRect = null;   // the toolbar plate in angular space {x0, x1}; its top is toolbarTopAng
script.api.setToolbarRect = function (x0, x1) { toolbarRect = { x0: x0, x1: x1 }; };
function tbBox(m) { return (toolbarRect && roomMode() && toolbarTopAng > -1) ? { x0: toolbarRect.x0 - m, x1: toolbarRect.x1 + m, top: toolbarTopAng + m } : null; }
script.api.toolbarBox = function () { return tbBox(0); };
function clampToBox(n, p) {
    if (n.anchored) { return n.pos; }   // a real-object node never moves
    if (roomMode()) {   // the room volume: floor to ceiling, side to side, and from just in front of the user to the far wall (an object may rest on the floor)
        var r = n.radius;
        var q = new vec3(Math.max(-(ROOM.x - r), Math.min(ROOM.x - r, p.x)), Math.max(FLOOR_Y + r, Math.min(ROOM.yMax - r, p.y)), Math.max(ROOM.zFar + r, Math.min(ROOM.zNear - r, p.z)));
        var tb = tbBox(0.004);   // the toolbar is a no-go zone: an object whose disc would overlap it is moved out the short way (left or up)
        if (tb) {
            var dep = Math.max(-q.z, 1), rA = r * 0.8 / dep, ax = q.x / dep, ay = q.y / dep;
            if (ax + rA > tb.x0 && ax - rA < tb.x1 && ay - rA < tb.top) {
                var mL = ax + rA - tb.x0, mU = tb.top - (ay - rA);
                if (mL <= mU) { q = new vec3(q.x - mL * dep, q.y, q.z); } else { q = new vec3(q.x, q.y + mU * dep, q.z); }
            }
        }
        return q;
    }
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
            if (A.anchored || B.anchored) { if (A.anchored && B.anchored) { continue; } wA = A.anchored ? 0 : 1; wB = B.anchored ? 0 : 1; }   // a real object is immovable: only the other one yields
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
function labelInView(P, e) {   // the whole label rectangle (centre P, half-size e.hw/e.hh) inside the visible view and above the toolbar
    var dp = Math.max(-P.z, 1), v = script.api.view(), lx = P.x / dp, ly = P.y / dp, hw = e.hw / dp, hh = e.hh / dp;
    return Math.abs(lx) + hw <= v.halfW / -WORLD_Z * 0.96 && ly + hh <= v.halfH / -WORLD_Z * 0.94 && ly - hh >= tbTop() + 0.01;
}
function labelPenalty(p, e, self) {   // how much a label rectangle (object position p) overlaps nodes (80% discs), UI rectangles and other labels, in angular units; 0 = clear
    var dep = Math.max(-p.z, 1), lx = (p.x + e.ox) / dep, ly = (p.y + e.oy) / dep, hw = e.hw / dep, hh = e.hh / dep, pen = 0;
    for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i], nd = Math.max(-n.pos.z, 1), nr = n.radius * 0.8 / nd;
        var dx = Math.max(Math.abs(lx - n.pos.x / nd) - hw, 0), dy = Math.max(Math.abs(ly - n.pos.y / nd) - hh, 0), d = Math.sqrt(dx * dx + dy * dy);
        if (d < nr) { pen += nr - d; }
    }
    var rs = [pillRect, testPill, cardRect];
    for (var pi = 0; pi < 3; pi++) { var pr = rs[pi]; if (pr && Math.abs(lx - pr.x) < hw + pr.hw && Math.abs(ly - pr.y) < hh + pr.hh) { pen += 0.1; } }
    for (var j = 0; j < placedLabels.length; j++) { var r = placedLabels[j]; if (r.c !== self && Math.abs(lx - r.x) < hw + r.hw && Math.abs(ly - r.y) < hh + r.hh) { pen += 0.1; } }
    return pen;
}
function placeRoomLabel(c, A, B) {   // room scale: the selected link's label sits at the beam's own midpoint, beside the beam and a little toward the camera; if that spot is crowded it slides sideways along the beam, never far
    var C = c.arcC || A.add(B).uniformScale(0.5), M = beamPoint(A, C, B, 0.5);
    var dx = B.x - A.x, dy = B.y - A.y, dl = Math.sqrt(dx * dx + dy * dy), tx = dl > 0.01 ? dx / dl : 1, ty = dl > 0.01 ? dy / dl : 0;
    var nx = -ty, ny = tx; if (ny < -0.001 || (Math.abs(ny) <= 0.001 && nx < 0)) { nx = -nx; ny = -ny; }   // prefer the upper side of the beam
    var toCam = M.uniformScale(-1 / Math.max(M.length, 0.01)), base = M.add(toCam.uniformScale(3 * K));
    c.labelTr.setWorldScale(vec3.one().uniformScale(Math.max(1, Math.min(3, -base.z / -WORLD_Z))));
    c.label.text = LABEL_TEXT[c.rule];
    var e = labelExtent(c), pos = null;
    if (!e) { pos = base.add(new vec3(nx * 5 * K, ny * 5 * K, 0)); }
    else {
        var gap = 0.9 * K * c.labelTr.getWorldScale().x, off = Math.abs(nx) * e.hw + Math.abs(ny) * e.hh + gap, step = (Math.abs(tx) * e.hw + Math.abs(ty) * e.hh) * 0.7 + 0.5 * K;
        var ks = [0, 1, -1, 2, -2], bestCost = 1e9, order = 0;   // candidates: ideal spot first, then sliding along the beam on either side; the least overlapping nearby one wins
        for (var ki = 0; ki < ks.length; ki++) {
            for (var si = 0; si < 2; si++, order++) {
                var sg = si === 0 ? 1 : -1, P = base.add(new vec3(nx * sg * off + tx * ks[ki] * step, ny * sg * off + ty * ks[ki] * step, 0)), op = P.sub(new vec3(e.ox, e.oy, 0));
                if (!labelInView(P, e)) { continue; }
                var dpP = Math.max(-P.z, 1), cost = labelPenalty(op, e, c) + 0.1 * Math.sqrt((P.x - M.x) * (P.x - M.x) + (P.y - M.y) * (P.y - M.y)) / dpP + order * 0.0001;   // overlap, plus a pull toward the beam midpoint so the label never wanders off
                if (cost < bestCost) { bestCost = cost; pos = op; }
            }
        }
        if (!pos) { pos = base.add(new vec3(nx * off, ny * off, 0)).sub(new vec3(e.ox, e.oy, 0)); }
    }
    c.labelNudge = 0;
    if (e) { var dd = Math.max(-pos.z, 1); c.lblRect = { c: c, x: (pos.x + e.ox) / dd, y: (pos.y + e.oy) / dd, hw: e.hw / dd, hh: e.hh / dd }; placedLabels.push(c.lblRect); }
    c.labelTr.setWorldPosition(pos);
    var kk = RULE_COLOR[c.rule];
    c.label.textFill.color = new vec4(kk.r, kk.g, kk.b, labelAlpha);
}
function updateLabel(c) {
    var shown = labelsAll || (editorLink === c && !roomMode());   // room: the open rule panel already names the rule, so no floating label
    c.labelObj.enabled = shown && c.active;
    if (!shown) { c.lblRect = null; c.labelNudge = 0; return; }
    var A = endOf(c.A), B = endOf(c.B);
    if (roomMode()) { placeRoomLabel(c, A, B); return; }
    var mid = A.add(B).uniformScale(0.5);
    var toCam = mid.uniformScale(-1 / Math.max(mid.length, 0.01));   // camera is at the origin
    var cx = 0; nodes.forEach(function (n) { cx += n.pos.x / nodes.length; });   // side links push their labels outward so labels don't pile up
    var dx = Math.max(-1, Math.min(1, (mid.x - cx) / (6 * K))) * 6.5 * K;
    var lp = mid.add(toCam.uniformScale(22)).add(new vec3(dx, 7 * K, 0));
    // in the room a label keeps the same on-screen size at any depth (scaled by depth / the UI plane's depth) and stays inside the visible width at its depth
    var lscale = roomMode() ? Math.max(1, Math.min(3, -lp.z / -WORLD_Z)) : 1;
    var lmx = roomMode() ? script.api.view().halfW / -WORLD_Z * Math.max(-lp.z, 1) * 0.8 : LABEL_MAX_X;   // keep wide labels inside the visible stage (a label at the far rim was clipped)
    lp = new vec3(Math.max(-lmx, Math.min(lmx, lp.x)), lp.y, lp.z);
    c.labelTr.setWorldScale(vec3.one().uniformScale(lscale));
    // never sit on top of an object: if the label's screen footprint touches any node, nudge it upward until clear
    var ext = labelExtent(c), nudged = 0, nstep = LABEL_NUDGE_STEP * lscale, nmax = LABEL_NUDGE_MAX * K;
    if (ext) { while (nudged < nmax && labelHitsNode(lp, ext, c)) { lp = lp.add(new vec3(0, nstep, 0)); nudged += nstep; } }
    c.labelNudge = nudged;
    if (ext) { var ddp = Math.max(-lp.z, 1); c.lblRect = { c: c, x: (lp.x + ext.ox) / ddp, y: (lp.y + ext.oy) / ddp, hw: ext.hw / ddp, hh: ext.hh / ddp }; placedLabels.push(c.lblRect); }
    c.labelTr.setWorldPosition(lp);
    c.label.text = LABEL_TEXT[c.rule];
    var k = RULE_COLOR[c.rule];
    c.label.textFill.color = new vec4(k.r, k.g, k.b, labelAlpha);
}
function endOf(n) { return n.vOff && roomMode() ? n.pos.add(n.vOff.uniformScale(n.growK)).add(new vec3(0, 0, n.radius * 0.5)) : n.pos; }   // where a beam attaches: the visual centre of the model (cat body, lotus centre), not the collision sphere centre
function beamPoint(A, C, B, u) { var a = (1 - u) * (1 - u), b = 2 * u * (1 - u), d = u * u; return new vec3(A.x * a + C.x * b + B.x * d, A.y * a + C.y * b + B.y * d, A.z * a + C.z * b + B.z * d); }
var ARC_SIMILAR = 0.77;   // cos 40 deg: two beams leaving one node closer than this in direction would run along each other
function arcTarget(c) {   // signed arc height multiplier (presentation only): beams that leave a node in similar directions arc to opposite sides, taller, so they read as separate
    for (var si = 0; si < 2; si++) {
        var S = si === 0 ? c.A : c.B, O = si === 0 ? c.B : c.A;
        var ux = O.pos.x - S.pos.x, uy = O.pos.y - S.pos.y, ul = Math.sqrt(ux * ux + uy * uy);
        if (ul < 0.01) { continue; }
        ux /= ul; uy /= ul;
        var rank = 0, any = false, myI = slots.indexOf(c);
        for (var k = 0; k < slots.length; k++) {
            var d = slots[k];
            if (d === c || !d.active || (d.A !== S && d.B !== S)) { continue; }
            var P = d.A === S ? d.B : d.A, vx = P.pos.x - S.pos.x, vy = P.pos.y - S.pos.y, vl = Math.sqrt(vx * vx + vy * vy);
            if (vl < 0.01 || (ux * vx + uy * vy) / vl < ARC_SIMILAR) { continue; }
            any = true; if (k < myI) { rank++; }
        }
        if (any) { return (rank % 2 === 0 ? 1 : -1) * (si === 0 ? 1 : -1) * (1.9 + Math.floor(rank / 2)); }
    }
    return 1;
}
function beamClip(c, amt, A, B, perp, dist) {   // how much a beam with this arc multiplier would pass through other objects (angular overlap with their discs); 0 = clear
    var h = Math.min(0.12 * dist, 4 * K) * amt, mid = A.add(B).uniformScale(0.5), C = mid.add(perp.uniformScale(2 * h)), pen = 0;
    for (var ni = 0; ni < nodes.length; ni++) {
        var n = nodes[ni]; if (n === c.A || n === c.B) { continue; }
        var nd = Math.max(-n.pos.z, 1), nx = n.pos.x / nd, ny = n.pos.y / nd, nr = n.radius * 0.8 / nd + 0.004;
        for (var si = 1; si < 10; si++) {
            var q = beamPoint(A, C, B, si / 10), qd = Math.max(-q.z, 1), ex = q.x / qd - nx, ey = q.y / qd - ny, dd = Math.sqrt(ex * ex + ey * ey);
            if (dd < nr) { pen += nr - dd; }
        }
    }
    var tb = tbBox(0.012);   // a beam also keeps clear of the toolbar plate
    if (tb) {
        for (var ti = 1; ti < 12; ti++) {
            var tq = beamPoint(A, C, B, ti / 12), td = Math.max(-tq.z, 1), tx = tq.x / td, ty = tq.y / td;
            if (tx > tb.x0 && tx < tb.x1 && ty < tb.top) { pen += 0.03; }
        }
    }
    return pen;
}
function routeArc(c, pref, A, B, perp, dist) {   // presentation only: keep the neighbour-separation preference unless the beam would run through another object, then bend the other way or higher
    if (nodes.length < 3 && !tbBox(0)) { return pref; }
    var cands = [c.arcT === undefined ? pref : c.arcT, pref, -pref, pref * 1.8, -pref * 1.8, pref * 2.6, -pref * 2.6], best = pref, bestPen = 1e9;
    for (var i = 0; i < cands.length; i++) {
        var pen = beamClip(c, cands[i], A, B, perp, dist);
        if (pen < 0.0005) { best = cands[i]; bestPen = 0; break; }
        if (pen < bestPen - 1e-6) { bestPen = pen; best = cands[i]; }
    }
    c.arcT = best; c.arcClip = bestPen;
    return best;
}
function updateVisual(c) {
    if (!perf.beams) { return; }
    var A = endOf(c.A), B = endOf(c.B);
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
    var w = Math.max(0.45 * K, Math.min(c.A.radius, c.B.radius) * (roomMode() ? 0.07 : 0.16)) * (1 + 1.2 * pk);   // thin beam: ~1 cm in the room (objects are 2.4x bigger on screen, so the same 0.16 radius ratio read as a fat band); never thinner than 0.45 cm at stage scale
    // gentle arc: always bulges to the left of A -> B, so it never flips side while objects move
    var perp0 = new vec3(-dir.y, dir.x, 0), arcT = roomMode() ? routeArc(c, arcTarget(c), A, B, perp0, dist) : arcTarget(c); c.arcAmt = c.arcAmt === undefined ? arcT : c.arcAmt + (arcT - c.arcAmt) * (1 - Math.exp(-8 * Math.max(lastDt, 0.016)));
    var perp = new vec3(-dir.y, dir.x, 0), h = Math.min(0.12 * dist, 4 * K) * c.arcAmt;
    var mid = A.add(B).uniformScale(0.5), C = mid.add(perp.uniformScale(2 * h));
    c.arcC = C;
    var amp = Math.min(0.55 * K, 0.022 * dist);   // gentle travelling wave along the arc, pinned at both ends
    function wp(u) { var q = beamPoint(A, C, B, u), sw = amp * Math.sin(Math.PI * u) * Math.sin(6.2832 * (1.0 * u - fxT * 0.4)); return new vec3(q.x + perp.x * sw, q.y + perp.y * sw, q.z); }
    function layer(list, N, wm) {
        var prev = A, sw = w * wm;
        for (var i = 0; i < N; i++) {
            var nx = wp((i + 1) / N), seg = list[i];
            var d = nx.sub(prev), len = Math.max(d.length, 0.001);
            var rot = quat.rotationFromTo(UP, d.uniformScale(1 / len));
            var sx = sw / c.mW, sy = len / c.mL, sz = sw / c.mD;
            var mp = prev.add(nx).uniformScale(0.5);
            seg.tr.setWorldRotation(rot);
            seg.tr.setLocalScale(new vec3(sx, sy, sz));
            seg.tr.setWorldPosition(mp.sub(rot.multiplyVec3(new vec3(c.mCenter.x * sx, c.mCenter.y * sy, c.mCenter.z * sz))));
            prev = nx;
        }
    }
    layer(c.segs, BEAM_SEGS, 1.1); layer(c.halo, HALO_N, 2.9); layer(c.core, CORE_N, 0.4);
    var mcol = lerp4(col, WHITE4, 0.55);   // motes: bright cores in the rule colour
    for (var m = 0; m < BEAM_MOTES; m++) {
        var u = (fxT * BEAM_FLOW + m / BEAM_MOTES + (c.beamPhase || 0)) % 1, mo = c.motes[m];
        mo.tr.setWorldPosition(wp(u).add(new vec3(0, 0, 0.3 * K)));
        var fade = Math.sin(Math.PI * u);
        mo.tr.setLocalScale(vec3.one().uniformScale(w * 2.6 * (0.6 + 0.4 * fade) / SPHERE_D));
        mo.pass.baseColor = new vec4(mcol.r * fade, mcol.g * fade, mcol.b * fade, fade);
    }
    var vwT = script.api.view(), limTx = vwT.halfW / -WORLD_Z * 0.9, limTy = vwT.halfH / -WORLD_Z * 0.9, tcol = lerp4(col, WHITE4, 0.45);
    for (var ts = 0; ts < c.trail.length; ts++) {   // sparkle trail: born on the beam, drifts sideways and up, fades; never shown near the view edge
        var T = c.trail[ts]; T.age += lastDt;
        if (T.age >= T.life) { T.age = 0; T.life = 1.0 + 0.8 * ambRand(); T.u = 0.1 + 0.8 * ambRand(); T.side = ambRand() < 0.5 ? -1 : 1; T.size = 0.4 + 0.4 * ambRand(); }
        var tu = T.age / T.life, tp = wp(T.u), off = (0.6 + 2.2 * tu) * K * T.side, tq = new vec3(tp.x + perp.x * off, tp.y + perp.y * off + 1.6 * K * tu, tp.z + 0.4 * K), tdp = Math.max(-tq.z, 1);
        var ta = (Math.abs(tq.x / tdp) > limTx || Math.abs(tq.y / tdp) > limTy) ? 0 : Math.sin(Math.PI * tu) * 0.7;
        T.tr.setWorldPosition(tq);
        T.tr.setLocalScale(vec3.one().uniformScale(T.size * K * (1 - 0.4 * tu) / SPHERE_D));
        T.pass.baseColor = new vec4(tcol.r * ta, tcol.g * ta, tcol.b * ta, ta);
    }
    if (c.collider) {   // wide invisible tap target, shorter than the span so objects stay grabbable
        var sh = c.collider.shape;
        sh.size = new vec3(6 * K, Math.max(dist - c.A.radius - c.B.radius, 1), 6 * K);
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
var AMB_MAX = 5, AMB_LIFE = 1.8, AMB_RATE = 4.5, ambPool = [], ambActive = [], ambAcc = 0, ambSeed = 12345, ambRound = 0;
function ambRand() { ambSeed = (ambSeed * 1664525 + 1013904223) % 4294967296; return ambSeed / 4294967296; }
function glowEmitters() { var out = []; nodes.forEach(function (n) { var k = n.modelRoot ? modelKind(n) : null; if (k === "lantern" || k === "flower" || (n.glowOn && !n.modelRoot)) { out.push(n); } }); return out; }
// Asset Library VFX (see README CREDITS): Embers drift off the lantern, Sparkles hover over the flower; each is only on while its object exists.
var vfxFollow = null;
var perf = { vfx: true, beams: true, glow: true, ambient: true, models: true, pools: true };   // test-only subsystem switches (api.test.perfSet) used to attribute frame cost
function updateVfx() {
    if (!perf.vfx) { if (script.embersVfx) { script.embersVfx.enabled = false; } if (script.sparklesVfx) { script.sparklesVfx.enabled = false; } return; }
    var lan = null, flo = null;
    nodes.forEach(function (n) { var k = n.modelRoot ? modelKind(n) : null; if (k === "lantern") { lan = n; } else if (k === "flower") { flo = n; } });
    if (script.sparklesVfx && script.sparklesVfx.enabled) { script.sparklesVfx.enabled = false; }   // the stock white-star Sparkles VFX wandered to the view edge as a stray star; the pink motes of the ambient sparkles stay
    if (script.embersVfx && script.embersVfx.enabled) { script.embersVfx.enabled = false; }   // the stock Embers VFX scattered red specks across the whole view; fireflies (updateMagic) replace it
    [].forEach(function (e) {
        var o = e[0], n = e[1]; if (!o) { return; }
        if (o.enabled !== !!n) { o.enabled = !!n; }
        if (n) { var t = o.getTransform(); t.setWorldPosition(n.pos.add(new vec3(0, n.radius * e[2], 0.5 * K))); t.setWorldScale(vec3.one().uniformScale(n.radius / 12)); }
    });
}
function updateAmbient(dt) {
    if (!perf.ambient) { ambActive.forEach(function (sp) { sp.o.enabled = false; }); ambActive.length = 0; return; }
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
            sp.p = new vec3(n.pos.x + Math.cos(a) * rr, n.pos.y + Math.sin(a) * rr * 0.8, n.pos.z + 0.8 * K);
            sp.col = n.modelRoot && modelKind(n) === "flower" ? new vec4(1, 0.6, 0.85, 1) : (n.modelRoot ? new vec4(1, 0.85, 0.45, 1) : lerp4(n.color, WHITE4, 0.5));
            sp.o.enabled = true; sp.tr.setWorldPosition(sp.p); ambActive.push(sp);
        }
    }
    for (var i = ambActive.length - 1; i >= 0; i--) {
        var s = ambActive[i]; s.age += dt;
        if (s.age >= AMB_LIFE) { s.o.enabled = false; ambActive.splice(i, 1); continue; }
        var u = s.age / AMB_LIFE, al = Math.sin(Math.PI * u) * 0.75;
        s.p = s.p.add(new vec3(Math.sin(s.age * 2.3 + s.size * 9) * 0.25 * K * dt, 2.2 * K * dt, 0));
        s.tr.setWorldPosition(s.p);
        s.tr.setLocalScale(vec3.one().uniformScale(s.size * K * (1 - 0.3 * u) / SPHERE_D));
        s.pass.baseColor = new vec4(s.col.r * al, s.col.g * al, s.col.b * al, al);
    }
}

// ---------- ambient magic: a few fireflies around the lantern, slow dust motes in the air (the lotus's petals/motes are the ambient sparkles above). Hard caps, always kept inside the view. ----------
var FIREFLY_MAX = 4, AIR_MAX = 4, magicPool = [], fireflies = [], airMotes = [];
function magicSprite() {
    var o = global.scene.createSceneObject("Magic Mote"), par = NODE_TMPL.getParent();
    if (par) { o.setParent(par); } o.layer = NODE_TMPL.layer; o.enabled = false;
    var v = o.createComponent("Component.RenderMeshVisual");
    v.mesh = SPHERE_MESH; v.mainMaterial = SPHERE_MAT.clone();
    v.mainPass.blendMode = BlendMode.Add; v.mainPass.depthWrite = false; v.mainPass.depthTest = false; v.setRenderOrder(6);
    var sp = { o: o, tr: o.getTransform(), pass: v.mainPass }; magicPool.push(sp); return sp;
}
function airSpawn(m, first) {
    var vw = script.api.view(), x = (ambRand() * 2 - 1) * vw.halfW * 1.25 * 0.7, y0 = FLOOR_Y + 8, y1 = ROOM.yMax - 4;
    m.p = new vec3(x, first ? y0 + ambRand() * (y1 - y0) : y0 + ambRand() * 6, -125 - ambRand() * 8);
    m.age = first ? ambRand() * 6 : 0; m.life = 6 + 3 * ambRand(); m.ph = ambRand() * 6.28; m.size = 0.35 + 0.3 * ambRand();
}
function updateMagic(dt) {
    var on = perf.ambient && roomMode() && nodes.length > 0, lan = null;
    nodes.forEach(function (n) { if (n.modelRoot && modelKind(n) === "lantern") { lan = n; } });
    while (fireflies.length < FIREFLY_MAX) { var f = magicSprite(); f.a = 0.5 + 1.3 * fireflies.length / FIREFLY_MAX; f.b = 0.7 + 0.5 * ambRand(); f.ph = ambRand() * 6.28; f.rho = 1.3 + 0.9 * fireflies.length / FIREFLY_MAX; f.blink = 0.9 + 0.8 * ambRand(); fireflies.push(f); }
    while (airMotes.length < AIR_MAX) { var m = magicSprite(); airSpawn(m, true); airMotes.push(m); }
    var vw = script.api.view(), limX = vw.halfW / -WORLD_Z * 0.9, limY = vw.halfH / -WORLD_Z * 0.9;
    fireflies.forEach(function (f) {
        f.o.enabled = on && !!lan; if (!f.o.enabled) { return; }
        var t = fxT * 0.45 + f.ph, r = lan.radius * f.rho, z = lan.pos.z + 0.6 * K;
        var px = lan.pos.x + Math.cos(t * f.a) * r, py = lan.pos.y + Math.sin(t * f.b * 1.3) * r * 0.75, dp = Math.max(-z, 1);
        px = Math.max(-limX * dp, Math.min(limX * dp, px)); py = Math.max(-limY * dp, Math.min(limY * dp, py));
        var bl = Math.max(0, Math.sin(fxT * f.blink * 2.2 + f.ph)), al = 0.25 + 0.7 * bl * bl;
        f.tr.setWorldPosition(new vec3(px, py, z));
        f.tr.setLocalScale(vec3.one().uniformScale(0.6 * K * (0.8 + 0.4 * bl) / SPHERE_D));
        f.pass.baseColor = new vec4(1.0 * al, 0.88 * al, 0.35 * al, al);
    });
    airMotes.forEach(function (m) {
        m.o.enabled = on; if (!on) { return; }
        m.age += dt; if (m.age >= m.life) { airSpawn(m, false); }
        var u = m.age / m.life, al = Math.sin(Math.PI * u) * 0.5;
        m.p = m.p.add(new vec3(Math.sin(m.age * 0.9 + m.ph) * 0.5 * K * dt, 0.45 * K * dt, 0));
        var dp = Math.max(-m.p.z, 1);
        if (Math.abs(m.p.x / dp) > limX || Math.abs(m.p.y / dp) > limY) { al = 0; }
        m.tr.setWorldPosition(m.p);
        m.tr.setLocalScale(vec3.one().uniformScale(m.size * K / SPHERE_D));
        m.pass.baseColor = new vec4(1.0 * al, 0.82 * al, 0.55 * al, al);
    });
}

// ---------- light pools: soft coloured glow on the room around the glowing creations (additive nested discs, no real lights) ----------
// A wall halo (camera-facing, just behind the model) and a flat pool on the surface under it (the sideboard top), warm orange for the lantern, pink for the lotus, faint warm for the cat.
var POOL_KIND = { lantern: { col: [1.0, 0.5, 0.14], wall: 2.5, floor: 2.4, a: 1.0 }, flower: { col: [1.0, 0.28, 0.65], wall: 2.1, floor: 2.1, a: 0.85 }, cat: { col: [1.0, 0.78, 0.45], wall: 1.7, floor: 1.7, a: 0.3 } };
var POOL_NW = 6, POOL_NF = 4;   // nested discs per wall halo / floor pool: layer i has radius (N - i) / N and adds A * (2i + 1) / N^2, so the sum falls off like (1 - r)^2 without visible rings (the shader squares alpha: colour and alpha are both premultiplied)
var poolDisc = null;
function poolMesh() {
    if (poolDisc) { return poolDisc; }
    var N = 28, tris = [];
    for (var i = 0; i < N; i++) { var a0 = 2 * Math.PI * i / N, a1 = 2 * Math.PI * (i + 1) / N; tris.push([[0, 0, 0], [Math.cos(a0) * 0.5, Math.sin(a0) * 0.5, 0], [Math.cos(a1) * 0.5, Math.sin(a1) * 0.5, 0]], [[0, 0, 0], [Math.cos(a1) * 0.5, Math.sin(a1) * 0.5, 0], [Math.cos(a0) * 0.5, Math.sin(a0) * 0.5, 0]]); }
    return (poolDisc = buildMesh(tris));
}
function makePool(n, kind) {
    var par = NODE_TMPL.getParent(), P = { kind: kind, wall: [], floor: [] };
    function mk(list, nm, flat, N) {
        for (var li = 0; li < N; li++) {
            var L = [(N - li) / N, (2 * li + 1) / (N * N)];
            var o = global.scene.createSceneObject(nm + " " + li);
            if (par) { o.setParent(par); } o.layer = NODE_TMPL.layer;
            var v = o.createComponent("Component.RenderMeshVisual");
            v.mesh = poolMesh(); v.mainMaterial = SPHERE_MAT.clone();
            v.mainPass.blendMode = BlendMode.Add; v.mainPass.depthWrite = false; v.mainPass.depthTest = !flat; v.setRenderOrder(-9);
            if (flat) { o.getTransform().setLocalRotation(quat.fromEulerAngles(-Math.PI / 2, 0, 0)); }
            list.push({ o: o, tr: o.getTransform(), pass: v.mainPass, L: L });
            n.extra = n.extra || []; n.extra.push(o);
        }
    }
    mk(P.wall, "Light Wall", false, POOL_NW); mk(P.floor, "Light Floor", true, POOL_NF);
    if (kind === "cat") { P.aura = []; mk(P.aura, "Cat Aura", false, 6); }   // a tight warm halo just behind the cat: only its rim shows around the model
    return P;
}
function updatePools(dt) {
    for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i], k = n.modelRoot ? modelKind(n) : null, spec = k ? POOL_KIND[k] : null;
        if (!spec) { continue; }
        if (!n.pool) { n.pool = makePool(n, k); }
        var P = n.pool, on = perf.pools && roomMode();
        var fl = k === "lantern" ? 0.88 + 0.07 * Math.sin(fxT * 7 + i) + 0.05 * Math.sin(fxT * 13.3) : 0.9 + 0.1 * Math.sin(fxT * 1.6 + i * 2);
        var h = Math.max(0, n.pos.y - n.radius - FLOOR_Y), hf = 1 / (1 + h / 22), R = n.radius * 2;
        var c = spec.col, vo = n.vOff ? n.vOff.uniformScale(n.growK) : vec3.zero();
        P.wall.forEach(function (S) {
            S.o.enabled = on; if (!on) { return; }
            var al = Math.min(0.75, Math.sqrt(0.36 * S.L[1] * spec.a * fl));
            S.tr.setWorldPosition(new vec3(n.pos.x + vo.x, n.pos.y + vo.y, n.pos.z - 4));
            S.tr.setLocalScale(vec3.one().uniformScale(R * spec.wall * S.L[0]));
            S.pass.baseColor = new vec4(c[0] * al, c[1] * al, c[2] * al, al);
        });
        if (P.aura) {
            var br = 0.85 + 0.15 * Math.sin(fxT * 1.3 + i);
            P.aura.forEach(function (S) {
                S.o.enabled = on; if (!on) { return; }
                var al = Math.min(0.8, Math.sqrt(0.5 * S.L[1] * br));
                S.tr.setWorldPosition(new vec3(n.pos.x + vo.x, n.pos.y + vo.y, n.pos.z - 2));
                S.tr.setLocalScale(vec3.one().uniformScale(R * 1.5 * S.L[0]));
                S.pass.baseColor = new vec4(1.0 * al, 0.84 * al, 0.5 * al, al);
            });
        }
        P.floor.forEach(function (S) {
            S.o.enabled = on && hf > 0.05; if (!on) { return; }
            var al = Math.min(0.8, Math.sqrt(0.5 * S.L[1] * spec.a * fl * (0.5 + 0.5 * hf))), rs = R * spec.floor * (1 + h / 70) * S.L[0];
            S.tr.setWorldPosition(new vec3(n.pos.x + vo.x, FLOOR_Y + 0.3, n.pos.z + 2));
            S.tr.setLocalScale(new vec3(rs * 1.3, rs * 0.9, 1));   // flat on the surface (rotated), a little wider than deep
            S.pass.baseColor = new vec4(c[0] * al, c[1] * al, c[2] * al, al);
        });
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
            if (dist > A.radius + B.radius + 0.1 * K) { continue; }
            var key = A.id + "_" + B.id; now[key] = true;
            if (contacts[key] || state !== "live" || A.dragging || B.dragging) { continue; }
            var dir = dist > 0.001 ? d.uniformScale(1 / dist) : new vec3(1, 0, 0);
            if (-B.vel.sub(A.vel).dot(dir) > CONTACT_APPROACH * K) { discover("contact", A.obj.name + "-" + B.obj.name); }
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
var discoveriesOn = false;   // Discoveries are off by default (the code and tests stay); api.setDiscoveries(true) turns the card and captions back on
script.api.setDiscoveries = function (on) { discoveriesOn = !!on; if (!on) { cardRect = null; } };
script.api.discoveriesOn = function () { return discoveriesOn; };
function updateCard() {
    if (cardSuppressed || !discoveriesOn) { cardRect = null; return; }
    var v = script.api.view(), ob = editorObstacles(true, true), step = 1.5 / CARD.d;
    function blocked(cx, cy, hw, hh) { return editorBlocked(cx, cy, hw, hh, ob, 0.8); }
    function scan(w, h) {   // the free spot nearest the preferred top corner (then nearest the other one)
        var hw = w / 2 / CARD.d, hh = h / 2 / CARD.d, best = null, bestC = 1e9, m = 1.0 / CARD.d;
        for (var ci = 0; ci < 2; ci++) {
            var side = ci === 0 ? cardCorner : -cardCorner, ax = side * (v.halfW / 95 - hw - m), ay = v.halfH / 95 - hh - m;
            for (var gy = ay; gy >= tbTop() + hh; gy -= step) {
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
var EDITOR_COLOR = { ATTRACT: [1.0, 0.42, 0.0], REPEL: [0.05, 0.5, 1.0], COLLISION_TRIGGER: [0.72, 0.15, 1.0], TRANSFER: [0.05, 0.85, 0.2], GROW: [1.0, 0.2, 0.62] };   // the rule panel: fully saturated
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
function editorObstacles(withNodes, skipCard, nodeScale) {   // everything the panel must keep clear of, in angular space
    var out = { discs: [], rects: [] };
    if (withNodes) { nodes.forEach(function (n) { var nd = Math.max(-n.pos.z, 1); out.discs.push({ x: n.pos.x / nd, y: n.pos.y / nd, r: n.radius * (nodeScale || 1) / nd }); }); }
    placedLabels.forEach(function (r) { out.rects.push(r); });
    [pillRect, testPill, skipCard ? null : cardRect].forEach(function (r) { if (r) { out.rects.push(r); } });
    return out;
}
function editorBlocked(cx, cy, hw, hh, ob, margin) {
    var v = script.api.view(), m = margin / EDITOR.d;
    if (Math.abs(cx) + hw > v.halfW / 95 - m || cy + hh > v.halfH / 95 - m || cy - hh < tbTop() + m) { return true; }
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
    var A = endOf(c.A), B = endOf(c.B), pts = [], Cc = c.arcC || A.add(B).uniformScale(0.5);
    for (var k = 0; k <= 12; k++) { var q = beamPoint(A, Cc, B, k / 12), qd = Math.max(-q.z, 1); pts.push({ x: q.x / qd, y: q.y / qd }); }   // the link as drawn (its arc), so the panel can stay off it
    var mx = pts[6].x, my = pts[6].y;
    function cost(cx, cy, hw, hh) {   // distance to the link's middle, heavily penalised when the panel would cover the link itself
        var cv = 0;
        for (var i = 0; i < pts.length; i++) { if (Math.abs(pts[i].x - cx) < hw + 0.012 && Math.abs(pts[i].y - cy) < hh + 0.012) { cv = 0.5; break; } }
        return Math.sqrt((cx - mx) * (cx - mx) + (cy - my) * (cy - my)) + cv;
    }
    var ob = editorObstacles(true), ob2 = null, step = EDITOR_STEP / EDITOR.d;
    var best = null, bestCost = 1e9, overlap = false;
    function scan(obs, only) {
        EDITOR.layouts.forEach(function (L, li) {
            if (only !== undefined && li !== only) { return; }
            var hw = L.w / 2 / EDITOR.d, hh = L.h / 2 / EDITOR.d;
            for (var gy = -v.halfH / 95 + hh; gy <= v.halfH / 95 - hh + 1e-6; gy += step) {
                for (var gx = -v.halfW / 95 + hw; gx <= v.halfW / 95 - hw + 1e-6; gx += step) {
                    var cc = cost(gx, gy, hw, hh);
                    if (cc >= bestCost || (only !== undefined && cc >= 0.5)) { continue; }   // preferred pass: never over the link it edits
                    if (!editorBlocked(gx, gy, hw, hh, obs, EDITOR_MARGIN)) { best = { x: gx, y: gy, li: li, hw: hw, hh: hh }; bestCost = cc; }
                }
            }
        });
    }
    scan(editorObstacles(true, false, roomMode() ? 0.62 : 1), 0);   // a single narrow column beside the link, off the beam (the visible models are smaller than their bounding spheres, so the first pass tolerates a little overlap with those)
    if (!best) { scan(ob); }
    if (!best) { ob2 = editorObstacles(false); scan(ob2); overlap = !!best; }   // crowded: keep clear of labels and the toolbar at least
    if (!best) {
        var L0 = EDITOR.layouts[1], h0 = L0.w / 2 / EDITOR.d, k0 = L0.h / 2 / EDITOR.d;
        best = { x: Math.max(-v.halfW / 95 + h0, Math.min(v.halfW / 95 - h0, mx)), y: Math.max(tbTop() + k0, Math.min(v.halfH / 95 - k0, my)), li: 1, hw: h0, hh: k0 }; overlap = true;
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
script.api.toolbarTop = function () { return tbTop(); };
function tbTop() { return roomMode() ? Math.max(toolbarTopAng, SIDEBOARD_TOP) : toolbarTopAng; }   // room: floating panels also stay above the sideboard line (the sideboard strip is where the objects stand)
script.api.editorSpec = EDITOR;
script.api.editorRules = function () { return ALL_RULES.map(function (r) { var k = EDITOR_COLOR[r]; return { rule: r, name: EDITOR_NAMES[r], color: [k[0], k[1], k[2]] }; }); };
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
function stepAsideOfReal(n) {   // Reset: a node whose start would overlap a real-object node's collision circle is set down beside it, still on the surface. The nearest free spot wins (sideways, or a little deeper into the room); if the full size does not fit, 20 cm then 18 cm cats are tried.
    var overl = false;
    for (var ri = 0; ri < nodes.length; ri++) { var Rn = nodes[ri]; if (Rn.anchored && Rn !== n && n.pos.distance(Rn.pos) < n.radius + Rn.radius - 0.3) { overl = true; } }
    if (!overl || !roomMode()) { return; }
    var standing = Math.abs(n.pos.y - n.radius - FLOOR_Y) < 0.6, vw = script.api.view(), tb = tbBox(0.004), ks = [1, 20 / 22, 18 / 22], start = n.pos;
    for (var ki = 0; ki < ks.length; ki++) {
        var r = n.size * 0.5 * ks[ki], y = standing ? FLOOR_Y + r : start.y, best = null, bestD = 25;
        for (var z = ROOM.zNear - r; z >= ROOM.zFar + r; z -= 1) {
            for (var x = -(ROOM.x - r); x <= ROOM.x - r; x += 1) {
                var p = new vec3(x, y, z), d = p.distance(start); if (d >= bestD) { continue; }
                var dep = -z, rA = r * 0.8 / dep, ok = Math.abs(x / dep) + rA <= vw.halfW / 95 * 0.95;
                if (ok && tb && x / dep + rA > tb.x0 && x / dep - rA < tb.x1 && y / dep - rA < tb.top) { ok = false; }
                for (var oi = 0; oi < nodes.length && ok; oi++) { var O = nodes[oi]; if (O === n) { continue; } if (p.distance(O.anchored ? O.pos : O.initial) < r + O.radius - 0.3) { ok = false; } }
                if (ok) { best = p; bestD = d; }
            }
        }
        if (best) {
            n.growK = ks[ki]; applyGrow(n); n.pos = best; n.tr.setLocalPosition(best);
            print("RULESHIFT reset: " + n.obj.name + " set down beside a real object at " + best.x.toFixed(1) + "," + best.y.toFixed(1) + "," + best.z.toFixed(1) + " (size " + (n.size * ks[ki]).toFixed(1) + ")");
            return;
        }
    }
    print("RULESHIFT reset: no free spot beside the real object for " + n.obj.name);
}
function resetWorld() {   // restores positions; created objects and links are kept
    nodes.forEach(function (n) {
        n.pos = new vec3(n.initial.x, n.initial.y, n.initial.z);
        n.vel = vec3.zero(); n.force = vec3.zero(); n.pulse = -1; n.dragging = false;
        n.growK = 1; applyGrow(n);
        n.tr.setLocalPosition(n.pos);
    });
    nodes.forEach(function (n) { if (!n.anchored) { stepAsideOfReal(n); } });   // an object whose start overlaps a real-object node is set down beside it instead
    clearCause(); contacts = {}; pendingRewrite = null; realMenu = null;
    connections.forEach(function (c) { c.cooldownUntil = 0; c.touching = false; updateVisual(c); });
    selNode = null; connectArmed = false;
    if (goalEnabled) { goalStage = 0; settleTime = 0; goalText.text = GOAL_1; nextText.text = "Next: " + GOAL_2; }
    setState("creation");
}
function clearAll() {
    clearCause();
    for (var k = slots.length - 1; k >= 0; k--) { destroySlot(slots[k]); }
    for (var i = nodes.length - 1; i >= 0; i--) { if (nodes[i].extra) { nodes[i].extra.forEach(function (o) { o.destroy(); }); } nodes[i].obj.destroy(); }
    realMenu = null;
    nodes.length = 0; refreshConnections(); updateEmptyHint(); resetDiscoveries();
    selNode = null; pendingPlace = null; setGoalEnabled(false);
    setState("creation");
    print("RULESHIFT cleared all");
}
// Legacy presets (demo, chain, universe) are authored at the 46 cm stage: LP maps a stage position to the same spot scaled about the camera by K (and K times deeper),
// which keeps their on-screen layout identical at room scale. The new "room" preset is authored directly in room coordinates.
function LP(x, y) { return new vec3(x * K, y * K, WORLD_Z * K); }
function loadDemo() {   // the starting set used for the video: pink, cyan, yellow spheres; pink-cyan attract, cyan-yellow repel
    clearAll();
    var a = spawnNode({ shape: "sphere", color: NODE_COLORS[0], size: 10 * K, accel: 1, rest: 0, pos: LP(-12, -9), name: "Sphere A" });
    var b = spawnNode({ shape: "sphere", color: NODE_COLORS[1], size: 10 * K, accel: 1, rest: 0, pos: LP(12, -9), name: "Sphere B" });
    var c = spawnNode({ shape: "sphere", color: NODE_COLORS[2], size: 10 * K, accel: 1, rest: 0, pos: LP(0, 4), name: "Sphere C" });
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
    var gem = spawnNode({ shape: "crystal", color: NODE_COLORS[0], size: 10 * K, glow: true, weight: "heavy", pos: LP(13, 4), name: "Gem" });
    var orb = spawnNode({ shape: "sphere", color: NODE_COLORS[1], size: 10 * K, weight: "light", pos: LP(-13, 4), name: "Orb" });
    var cube = spawnNode({ shape: "cube", color: NODE_COLORS[2], size: 10 * K, pos: LP(-2, -4), name: "Cube" });
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
    var base = 12 * K;
    var home = spawnModelNode(script.homeModel, "Home", base * 1.5, "heavy", LP(-14, 7), NODE_COLORS[2]);
    var cat = spawnModelNode(script.catModel, "Cat", base * 0.7, "light", LP(0.2, 7.6), NODE_COLORS[0]);
    var lantern = spawnModelNode(script.lanternModel, "Lantern", base * 0.85, "heavy", LP(17, -16), NODE_COLORS[1]);
    var flower = spawnModelNode(script.flowerModel, "Flower", base, null, LP(16, 5.5), NODE_COLORS[0]);
    if (home && cat && lantern && flower) {
        activateLink(slotFor(lantern, flower, true), RULES.COLLISION_TRIGGER, true);   // first, so its label gets the spot nearest its link
        activateLink(slotFor(cat, lantern, true), RULES.ATTRACT, true);
        activateLink(slotFor(cat, home, true), RULES.ATTRACT, true);
    }
    pendingPlace = null;
    print("RULESHIFT demo stage: universe");
}
script.api.loadUniverse = loadUniverse;
// demoStage "room": the sample world, authored directly in room coordinates (cm, camera at the origin looking down -z; table top y = TABLE_Y, floor y = FLOOR_Y).
// The island house floats above the real table, the lantern floats elsewhere, the flower and the cat rest on the floor (cat between them and the house).
// The story runs through the real rule engine: cat-lantern ATTRACT, lantern-flower COLLISION TRIGGER. Press Play and the cat travels to the lantern;
// drag the lantern into the flower and the collision's pulse flips cat-lantern to REPEL, so the cat flees back toward the house. Nothing collides by itself.
var ROOM_LAYOUT = {   // hero sizes 20-40 cm; centres in cm, all about 1.25 m out, inside the default Preview view (+-36 cm wide, -24..+41 cm tall at that depth, above the toolbar); table-resting items sit on FLOOR_Y (the virtual table)
    home: { size: 28, x: -21, y: 24, z: -125 },        // floating island house, high on the left, behind the cat on the side away from the lantern
    cat: { size: 22, x: -25, y: null, z: -125 },       // standing on the sideboard, left
    lantern: { size: 22, x: 16, y: 10, z: -125 },      // floating above the sideboard, right of centre
    flower: { size: 20, x: -3.5, y: null, z: -125 }       // standing on the sideboard, centre (the toolbar is low in the far right corner)
};
function loadRoom() {
    clearAll();
    var L = ROOM_LAYOUT;
    function at(o) { return new vec3(o.x, o.y === null ? FLOOR_Y + o.size / 2 : o.y, o.z); }
    var home = spawnModelNode(script.homeModel, "Home", L.home.size, "heavy", at(L.home), NODE_COLORS[2]);
    var cat = spawnModelNode(script.catModel, "Cat", L.cat.size, "light", at(L.cat), NODE_COLORS[0]);
    var lantern = spawnModelNode(script.lanternModel, "Lantern", L.lantern.size, "heavy", at(L.lantern), NODE_COLORS[1]);
    var flower = spawnModelNode(script.flowerModel, "Flower", L.flower.size, null, at(L.flower), NODE_COLORS[0]);
    if (home && cat && lantern && flower) {
        activateLink(slotFor(lantern, flower, true), RULES.COLLISION_TRIGGER, true);
        activateLink(slotFor(cat, lantern, true), RULES.ATTRACT, true);   // no cat-home link at the start: the house only marks where the cat flees to
    }
    pendingPlace = null;
    print("RULESHIFT demo stage: room");
}
script.api.loadRoom = loadRoom;
function applyDemoSetup() {
    if (script.demoStage === "chain") { loadChain(); } else if (script.demoStage === "universe") { loadUniverse(); } else if (script.demoStage === "room") { loadRoom(); } else { clearAll(); pendingPlace = null; }
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
Object.defineProperty(script.api, "tableY", { get: function () { return tableY(); } });
script.api.floorY = FLOOR_Y;
script.api.room = { floorY: FLOOR_Y, tableY: TABLE_Y_ROOM, tableRect: TABLE_RECT, volume: ROOM, layout: ROOM_LAYOUT };
script.api.worldScale = function () { return K; };
script.api.count = function () { return nodes.length; };
script.api.maxNodes = MAX_NODES;
// "Your creations": the saved generated models (the Snap3D results kept in the project) can be dropped into the room with one tap.
var SAVED = [["House", "homeModel", 0.9], ["Cat", "catModel", 0.8], ["Lantern", "lanternModel", 0.7], ["Flower", "flowerModel", 0.7]];
script.api.savedModels = function () { return SAVED.filter(function (d) { return !!script[d[1]]; }).map(function (d) { return d[0]; }); };
script.api.spawnSaved = function (name) {
    var d = SAVED.filter(function (e) { return e[0] === name; })[0];
    if (!d || !script[d[1]]) { return -1; }
    var n = spawnModelNode(script[d[1]], name, imagineSize() * (roomMode() ? 1.1 : 1), d[0] === "House" ? "heavy" : "light", findFreeSpot(imagineSize() * 0.5), NODE_COLORS[0]);
    if (!n) { return -1; }
    if (pendingPlace === n) { pendingPlace = null; }
    return nodeIndex(n);
};
script.api.deleteSelected = function () { return selNode ? deleteNode(selNode) : false; };
script.api.selectedInfo = function () {
    if (!selNode) { return null; }
    // busy: an "Imagining…" / failure caption is showing above this node, so the Delete pill stays hidden (it would overlap the caption)
    return { x: selNode.pos.x, y: selNode.pos.y, z: selNode.pos.z, r: selNode.radius, busy: !!(selNode.job && selNode.job.cap) };
};
// UI helpers for the palette (TypeScript side): an opaque plate and a round colour swatch, built from the shared meshes.
script.api.makePlate = function (name, w, h, d, pos, col, order, solid) {
    var o = global.scene.createSceneObject(name);
    var v = o.createComponent("Component.RenderMeshVisual");
    v.mesh = LINK_MESH; v.mainMaterial = SPHERE_MAT.clone(); v.mainPass.baseColor = col;
    if (solid) { v.mainPass.blendMode = BlendMode.Normal; v.mainPass.depthWrite = false; }   // opaque backing: the room behind does not show through as noise
    if (order !== undefined) { v.mainPass.depthTest = false; v.setRenderOrder(order); }   // drawn beneath the UI buttons regardless of depth
    var mn = LINK_MESH.aabbMin, mx = LINK_MESH.aabbMax;
    var mw = Math.max(mx.x - mn.x, 0.0001), ml = Math.max(mx.y - mn.y, 0.0001), md = Math.max(mx.z - mn.z, 0.0001);
    var t = o.getTransform();
    t.setWorldRotation(quat.fromEulerAngles(0, 0, Math.PI / 2));   // mesh long axis is Y; lay it along X
    t.setWorldScale(new vec3(h / mw, w / ml, d / md));
    t.setWorldPosition(pos);
    return o;
};
// Glassy UI helpers: rounded rectangles (filled or as a thin frame), and small flat rule icons. Meshes are built in cm (the object is not scaled), cached by size.
var roundCache = {};
function rrPts(w, h, r, seg) {
    r = Math.max(0.02, Math.min(r, w / 2 - 0.01, h / 2 - 0.01)); var pts = [], cs = [[1, 1, 0], [-1, 1, 90], [-1, -1, 180], [1, -1, 270]];
    cs.forEach(function (c) { for (var i = 0; i <= seg; i++) { var a = (c[2] + 90 * i / seg) * Math.PI / 180; pts.push([c[0] * (w / 2 - r) + Math.cos(a) * r, c[1] * (h / 2 - r) + Math.sin(a) * r, 0]); } });
    return pts;
}
function roundMesh(w, h, r, ringT) {
    var key = [w.toFixed(3), h.toFixed(3), r.toFixed(3), ringT || 0].join("_");
    if (roundCache[key]) { return roundCache[key]; }
    var tris = [], o = rrPts(w, h, r, 6), n = o.length, i, j;
    if (!ringT) { for (i = 0; i < n; i++) { j = (i + 1) % n; tris.push([[0, 0, 0], o[i], o[j]], [[0, 0, 0], o[j], o[i]]); } }
    else {
        var q = rrPts(Math.max(w - 2 * ringT, 0.05), Math.max(h - 2 * ringT, 0.05), Math.max(r - ringT, 0.05), 6);
        for (i = 0; i < n; i++) { j = (i + 1) % n; tris.push([o[i], o[j], q[j]], [o[i], q[j], q[i]], [o[i], q[j], o[j]], [o[i], q[i], q[j]]); }
    }
    return (roundCache[key] = buildMesh(tris));
}
// name, size w x h (cm), corner radius, position (world, or local when parent is given), colour, render order, additive?, parent, frame thickness (0 = filled)
script.api.makeRound = function (name, w, h, r, pos, col, order, add, parent, ringT) {
    var o = global.scene.createSceneObject(name);
    if (parent) { o.setParent(parent); o.getTransform().setLocalPosition(pos); } else { o.getTransform().setWorldPosition(pos); }
    var v = o.createComponent("Component.RenderMeshVisual");
    v.mesh = roundMesh(w, h, r, ringT || 0); v.mainMaterial = SPHERE_MAT.clone(); v.mainPass.baseColor = col;
    v.mainPass.blendMode = add ? BlendMode.Add : BlendMode.Normal; v.mainPass.depthWrite = false; v.mainPass.depthTest = false; v.setRenderOrder(order);
    return o;
};
script.api.makeRuleIcon = function (rule, size, col, parent, order) {   // a small flat white glyph per rule, unit box scaled by size
    var T = [], k, a;
    function fan(pts) { for (var i = 0; i < pts.length; i++) { var j = (i + 1) % pts.length; T.push([[0, 0, 0], pts[i], pts[j]], [[0, 0, 0], pts[j], pts[i]]); } }
    function tri3(a, b, c) { T.push([a, b, c], [a, c, b]); }
    if (rule === "ATTRACT") { tri3([-0.46, -0.24, 0], [-0.46, 0.24, 0], [-0.04, 0, 0]); tri3([0.46, -0.24, 0], [0.46, 0.24, 0], [0.04, 0, 0]); }
    else if (rule === "REPEL") { tri3([-0.04, -0.24, 0], [-0.04, 0.24, 0], [-0.46, 0, 0]); tri3([0.04, -0.24, 0], [0.04, 0.24, 0], [0.46, 0, 0]); }
    else if (rule === "COLLISION_TRIGGER") { var st = []; for (k = 0; k < 8; k++) { a = k * Math.PI / 4; var rr = k % 2 === 0 ? 0.48 : 0.15; st.push([Math.cos(a) * rr, Math.sin(a) * rr, 0]); } fan(st); }
    else if (rule === "TRANSFER") { tri3([-0.46, -0.1, 0], [0.04, -0.1, 0], [0.04, 0.1, 0]); tri3([-0.46, -0.1, 0], [0.04, 0.1, 0], [-0.46, 0.1, 0]); tri3([0.04, -0.3, 0], [0.04, 0.3, 0], [0.48, 0, 0]); }
    else { var dsk = []; for (k = 0; k < 16; k++) { a = k * Math.PI / 8; dsk.push([Math.cos(a) * 0.14, Math.sin(a) * 0.14, 0]); } fan(dsk); for (k = 0; k < 20; k++) { var a0 = k * Math.PI / 10, a1 = (k + 1) * Math.PI / 10; var A0 = [Math.cos(a0) * 0.3, Math.sin(a0) * 0.3, 0], B0 = [Math.cos(a0) * 0.46, Math.sin(a0) * 0.46, 0], A1 = [Math.cos(a1) * 0.3, Math.sin(a1) * 0.3, 0], B1 = [Math.cos(a1) * 0.46, Math.sin(a1) * 0.46, 0]; T.push([A0, B0, B1], [A0, B1, B0], [A0, B1, A1], [A0, A1, B1]); } }
    var o = global.scene.createSceneObject("Rule Icon " + rule);
    if (parent) { o.setParent(parent); o.getTransform().setLocalPosition(vec3.zero()); }
    var v = o.createComponent("Component.RenderMeshVisual");
    v.mesh = buildMesh(T); v.mainMaterial = SPHERE_MAT.clone(); v.mainPass.baseColor = col;
    v.mainPass.blendMode = BlendMode.Normal; v.mainPass.depthWrite = false; v.mainPass.depthTest = false; v.setRenderOrder(order);
    o.getTransform().setLocalScale(vec3.one().uniformScale(size));
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
    // the legacy regression suite runs at the original stage scale (K = 1); the room suite at ROOM_K. Switch only while no objects exist (clearAll first).
    setWorldScale: function (k) { K = k; causePool.forEach(function (p) { p.parts.forEach(function (t, i) { t.setLocalScale(vec3.one().uniformScale(CAUSE_SIZES[i] * K / SPHERE_D)); }); }); },
    ROOM_K: ROOM_K,
    perfSet: function (name, on) {
        perf[name] = !!on;
        if (name === "beams") { connections.forEach(function (c) { c.visual.enabled = !!on; }); }
        if (name === "glow") { nodes.forEach(function (n) { (n.glow || []).forEach(function (o) { o.enabled = !!on; }); }); }
        if (name === "models") { nodes.forEach(function (n) { if (n.modelRoot) { n.modelRoot.enabled = !!on; } }); }
    },
    prof: function (on) { PROF = !!on; profAcc = {}; profFrames = 0; },
    profReport: function () { var o = []; for (var k in profAcc) { o.push(k + "=" + (profAcc[k] / Math.max(profFrames, 1)).toFixed(2)); } var rr = o.join(" ") + " (ms/frame over " + profFrames + " frames)"; profAcc = {}; profFrames = 0; return rr; },
    planeHit: function (o, d) { var h = planeHit(o, d); return h ? { p: h, surface: lastSurface } : null; },
    nodes: nodes, connections: connections, slots: slots,
    tap: function (i) { handleTapNode(nodes[i]); },
    pressStart: function (i) { pressStartNode(nodes[i]); },
    realPinchRay: function (o, d) { openRealMenu(o, d); },
    realPinchScreen: function (sp) { return realPinchAtScreen(sp); },
    spawnReal: function (name, size, pos) { return nodes.indexOf(spawnRealNode(name, size, pos)); },
    realInfo: function (i) { var n = nodes[i]; return n && n.real ? { anchored: !!n.anchored, radius: n.radius, rings: n.rings.length, tag: n.tag.text.text, tagY: n.tag.tr.getWorldPosition().y, modelVisible: n.parts.some(function (p) { return p.rmv.enabled; }), ringBox: n.ringBox, tagAng: { x: n.tag.tr.getWorldPosition().x / Math.max(-n.pos.z, 1), y: n.tag.tr.getWorldPosition().y / Math.max(-n.pos.z, 1) }, pos: n.pos, trPos: n.tr.getLocalPosition() } : null; },
    pressEnd: function (i, allowTap) { pressEndNode(nodes[i], allowTap); },
    growNode: growNode, applyGrow: applyGrow, GROW_CAP: GROW_CAP,
    discovered: function () { return DISCOVERIES.filter(function (d) { return discovered[d.id]; }).map(function (d) { return d.id; }); },
    sparkleActive: function () { return sparkActive.length; },
    cardOverlaps: function () {
        if (!cardRect) { return -1; }
        var ob = editorObstacles(true, true), r = cardRect, n = 0, v = script.api.view();
        ob.discs.forEach(function (d) { var dx = Math.max(Math.abs(r.x - d.x) - r.hw, 0), dy = Math.max(Math.abs(r.y - d.y) - r.hh, 0); if (dx * dx + dy * dy < d.r * d.r) { n++; } });
        ob.rects.forEach(function (o) { if (Math.abs(r.x - o.x) < r.hw + o.hw && Math.abs(r.y - o.y) < r.hh + o.hh) { n++; } });
        if (Math.abs(r.x) + r.hw > v.halfW / 95 || r.y + r.hh > v.halfH / 95 || r.y - r.hh < tbTop()) { n++; }
        return n;
    },
    openEditor: openEditor, closeEditor: function () { closeEditor("test"); }, editorTouch: editorTouch, toggleEditor: toggleEditor,
    editorOpen: function () { return editorLink ? slots.indexOf(editorLink) : -1; },
    editorRect: function () { return editorRect; },
    editorOverlaps: function () {   // how many things the placed panel covers (nodes, labels, Delete pill) plus whether it leaves the view / touches the toolbar
        if (!editorRect) { return -1; }
        var ob = editorObstacles(true, false, roomMode() ? 0.62 : 1), r = editorRect, n = 0, v = script.api.view();
        ob.discs.forEach(function (d) { var dx = Math.max(Math.abs(r.x - d.x) - r.hw, 0), dy = Math.max(Math.abs(r.y - d.y) - r.hh, 0); if (dx * dx + dy * dy < d.r * d.r) { n++; } });
        ob.rects.forEach(function (o) { if (Math.abs(r.x - o.x) < r.hw + o.hw && Math.abs(r.y - o.y) < r.hh + o.hh) { n++; } });
        if (Math.abs(r.x) + r.hw > v.halfW / 95 || r.y + r.hh > v.halfH / 95 || r.y - r.hh < tbTop()) { n++; }
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
    get box() { return roomMode() ? { x: ROOM.x, yMin: FLOOR_Y, yMax: ROOM.yMax, zr: 0, buttonTop: -1e9, zNear: ROOM.zNear, zFar: ROOM.zFar } : { x: BOX_X, yMin: BOX_YMIN, yMax: BOX_YMAX, zr: BOX_Z, buttonTop: -21 }; },
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
    magicCount: function () { var c = 0; fireflies.concat(airMotes).forEach(function (m) { if (m.o.enabled) { c++; } }); return c; }, magicMax: FIREFLY_MAX + AIR_MAX,
    ambientMax: AMB_MAX,
    linkColor: function (c) { var k = c.rmv.mainPass.baseColor; return k.r.toFixed(2) + "," + k.g.toFixed(2) + "," + k.b.toFixed(2); },
    place: function (i, v) { var n = nodes[i]; n.pos = new vec3(v.x, v.y, v.z); n.vel = vec3.zero(); n.tr.setLocalPosition(n.pos); if (pendingPlace === n) { pendingPlace = null; } },
    connect: function (i, j, rule) { var c = slotFor(nodes[i], nodes[j], true); if (!c.active) { activateLink(c, rule || RULES.ATTRACT, true); } return c; },
    labelInfo: function (c) { var e = labelExtent(c); var p = c.labelTr.getWorldPosition(); return { ext: e, nudge: c.labelNudge, y: p.y, hits: e ? labelHitsNode(p, e, c) : null }; },
    labelToMid: function (c) { var C = c.arcC || endOf(c.A).add(endOf(c.B)).uniformScale(0.5), M = beamPoint(endOf(c.A), C, endOf(c.B), 0.5), e = labelExtent(c), p = c.labelTr.getWorldPosition(); if (!e) { return -1; } var dx = p.x + e.ox - M.x, dy = p.y + e.oy - M.y; return Math.sqrt(dx * dx + dy * dy); },
    visualBottom: function (i) { var n = nodes[i], b = n && n.modelRoot ? worldBounds(n.modelRoot) : null; return b ? b.min.y : null; },
    beamClipNow: function (c) { var A = endOf(c.A), B = endOf(c.B), d = B.sub(A), dist = Math.max(d.length, 0.01), dir = d.uniformScale(1 / dist); return beamClip(c, c.arcAmt === undefined ? 1 : c.arcAmt, A, B, new vec3(-dir.y, dir.x, 0), dist); },
    beamClip: function (c) { return c.arcClip === undefined ? 0 : c.arcClip; },
    labelFits: function (c) { var e = labelExtent(c); return !!e && labelInView(c.labelTr.getWorldPosition().add(new vec3(e.ox, e.oy, 0)), e); },
    armHaloOn: function () { return !!armHalo && armHalo.enabled; },
    fires: function (c) { return c.fires || 0; },
    hintVisible: function () { return hintObj.enabled; },
    labelOverlaps: function () { var n = 0, cs = connections; for (var i = 0; i < cs.length; i++) { for (var j = i + 1; j < cs.length; j++) { var a = cs[i].lblRect, b = cs[j].lblRect; if (a && b && Math.abs(a.x - b.x) < a.hw + b.hw && Math.abs(a.y - b.y) < a.hh + b.hh) { n++; } } } return n; },
    glowInfo: function (i) { var n = nodes[i]; return n.glow.map(function (o) { var p = o.getComponent("Component.RenderMeshVisual").mainPass; return { blend: p.blendMode, alpha: p.baseColor.a }; }); }
};

var SUBSTEP = 0.02, MAX_SUBSTEPS = 6, fixedStep = 0;   // fixedStep > 0 (tests only) replaces real dt with a constant step
var elapsed = 0, lastToggle = 0;
var PROF = false, profAcc = {}, profLast = 0, profFrames = 0;   // CPU profile of the update loop (test only: api.test.prof(true)); Date.now has ms resolution, so read the per-frame averages
function pm(name) { if (!PROF) { return; } var t = Date.now(); profAcc[name] = (profAcc[name] || 0) + (t - profLast); profLast = t; }
script.createEvent("UpdateEvent").bind(function (e) {
    if (PROF) { profLast = Date.now(); profFrames++; }
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
    pm("pre"); syncDragged();
    if (state === "live") {   // real elapsed time, split into fixed substeps so motion keeps real-time speed at low fps without going unstable
        var total = fixedStep > 0 ? fixedStep : Math.min(fdt, MAX_SUBSTEPS * SUBSTEP);
        var steps = Math.max(1, Math.min(MAX_SUBSTEPS, Math.ceil(total / SUBSTEP - 1e-6)));
        lastDt = total;
        for (var si = 0; si < steps; si++) {
            computeForces();
            integrate(total / steps);
        }
    }
    pm("physics"); detectContacts(); pm("contacts");
    for (var it = 0; it < 6; it++) {   // push apart, then re-clamp so a shove can never leave the box
        resolveOverlaps(it >= 2);
        nodes.forEach(function (n) { if (!n.dragging || it >= 2) { n.pos = clampToBox(n, n.pos); n.tr.setLocalPosition(n.pos); } });
    }
    pm("overlaps"); if (state === "live") { checkCollisions(); }
    updatePulses(dt);
    updateCause(realDt);
    pm("pulses"); updateRewrite(realDt); updateSparkles(realDt); pm("sparkles"); updateAmbient(realDt); pm("ambient"); updateVfx(); updateModelLife(realDt); pm("life"); updatePools(realDt); updateMagic(realDt);
    updateImagine(dt);
    updateSelection(); updateRealVisuals();
    hintObj.enabled = !!pendingPlace && !goalEnabled;
    updateGoal(Math.min(fdt, 0.25));   // real time, so goal timers don't slow down at low frame rates
    placedLabels.length = 0;
    pm("goal"); connections.forEach(updateLabel); pm("labels");
    connections.forEach(updateVisual); pm("beams");
    updateCard();
    updateEditor(); pm("ui");
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

// ---------- No stage: the world is the user's room (see ROOM / FLOOR_Y / TABLE_Y above). The glowing placement disc was removed; objects rest on real surfaces or float. ----------
script.api.nodeDiscs = function () { return nodes.map(function (n) { var dp = Math.max(-n.pos.z, 1); return { x: n.pos.x / dp, y: n.pos.y / dp, r: n.radius * 0.85 / dp }; }); };   // (85%: the visible model is smaller than its bounding sphere) angular discs, so the Create menu can open in empty space
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
function imagineSize() { return roomMode() ? 12 * K : 18; }   // node footprint in cm: 18 at the legacy stage; 16 x K = 38 cm in the room (inside the 20-40 cm hero range)
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
    if (roomMode() && job.hero) { var ext = b.max.sub(b.min), longest = Math.max(ext.x, ext.y, ext.z); if (longest > 1e-5) { f = Math.min(n.size * 0.5 / b.radius * 1.6, HERO_CM / longest); } }   // a generated model is sized by its longest side (a flat flower no longer shrinks to fit a sphere around its diagonal)
    ht.setLocalScale(vec3.one().uniformScale(f));
    ht.setWorldPosition(nodeW.sub(off.uniformScale(f)));
    var b2 = worldBounds(holder);
    if (roomMode() && b2) {   // ground it: the model's lowest point sits exactly on the bottom of its collision sphere, so a body resting on a surface visibly touches it
        var gap = b2.min.y - (nodeW.y - n.size * 0.5);
        if (gap > 0.01) { ht.setWorldPosition(ht.getWorldPosition().sub(new vec3(0, gap, 0))); b2 = worldBounds(holder); }
        n.vOff = new vec3(b2.center.x - nodeW.x, b2.center.y - nodeW.y, 0);   // beams attach at the model's visual centre
    }
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
// In the room a caption hangs just above its own object (objects are at different depths), at the object's depth and scaled so it keeps a constant on-screen size.
var CAP_MARGIN = 4, CAP_STEP = 4.5, CAP_MAX_Y = 22;
function captionY(slot) {
    var top = BOX_YMAX;
    nodes.forEach(function (n) { top = Math.max(top, n.pos.y + n.radius); });
    return Math.min(top + CAP_MARGIN, CAP_MAX_Y - 0) + (slot || 0) * CAP_STEP;
}
function placeCaption(job, slot) {
    if (!roomMode()) { job.cap.tr.setWorldPosition(new vec3(0, captionY(slot), WORLD_Z)); return; }
    var n = job.n, s = Math.max(1, -n.pos.z / -WORLD_Z);
    job.cap.tr.setWorldScale(vec3.one().uniformScale(s));
    job.cap.tr.setWorldPosition(new vec3(n.pos.x, n.pos.y + n.radius + (CAP_MARGIN + slot * CAP_STEP) * s, n.pos.z + n.radius + 1));   // slightly in front of the object so the text is never inside it
}
function capSlot(job) { var k = 0; for (var i = 0; i < imagineJobs.length; i++) { if (imagineJobs[i] === job) { return k; } if (imagineJobs[i].cap) { k++; } } return k; }
function styleCaption(t) {   // readable on any background: dark outline
    t.outlineSettings.enabled = true; t.outlineSettings.size = 0.5; t.outlineSettings.fill.color = new vec4(0.05, 0.03, 0.2, 1);
}
function heroSpot(radius) {   // room: a spot in the visible part of the view clear of every object, every beam and the toolbar; nearest to the middle of the view wins
    var z0 = spawnPlane(), dep = -z0, vw = script.api.view(), tb = tbBox(0.01), rA = radius * 0.85 / dep, best = null, bestCost = 1e9;
    var limX = vw.halfW / -WORLD_Z * 0.95 - rA, lo = Math.max(FLOOR_Y / dep + rA + 0.01, -0.2), hi = vw.halfH / -WORLD_Z * 0.97 - rA;
    var beams = [];
    for (var ci = 0; ci < connections.length; ci++) { var c = connections[ci]; if (!c.active) { continue; } var A = endOf(c.A), B = endOf(c.B), Cc = c.arcC || A.add(B).uniformScale(0.5); for (var k = 0; k <= 16; k++) { var q = beamPoint(A, Cc, B, k / 16), qd = Math.max(-q.z, 1); beams.push({ x: q.x / qd, y: q.y / qd }); } }
    for (var pass = 0; pass < 2 && !best; pass++) for (var gy = hi; gy >= lo; gy -= 0.02) {
        for (var gx = -limX; gx <= limX + 1e-6; gx += 0.02) {
            var cost = Math.abs(gx) * 0.5 + Math.abs(gy - 0.1) * 0.7, bad = false;
            if (tb && gx + rA > tb.x0 && gx - rA < tb.x1 && gy - rA < tb.top) { continue; }
            for (var i = 0; i < nodes.length && !bad; i++) { var n = nodes[i], nd = Math.max(-n.pos.z, 1), ex = n.pos.x / nd - gx, ey = n.pos.y / nd - gy, rr = n.radius * 0.85 / nd + rA + 0.01; if (ex * ex + ey * ey < rr * rr) { bad = true; } }
            for (var j = 0; j < beams.length && !bad && pass === 0; j++) { var bx = beams[j].x - gx, by = beams[j].y - gy; if (bx * bx + by * by < (rA + 0.015) * (rA + 0.015)) { bad = true; } }
            if (!bad && cost < bestCost) { bestCost = cost; best = new vec3(gx * dep, gy * dep, z0); }
        }
    }
    return best;
}
var HERO_CM = 22;   // the longest side of a generated model in the room (a hero size, like the lantern)
function imagine(prompt) {
    prompt = cleanPrompt(prompt) || String(prompt || "").trim();
    var hs = roomMode() ? heroSpot(imagineSize() * 0.5) : null;
    var n = spawnNode({ shape: "sphere", color: IMAGINE_COLOR, glow: true, size: imagineSize(), name: "Imagined: " + prompt, pos: hs || undefined });
    if (!n) { return -1; }
    if (pendingPlace === n) { pendingPlace = null; }   // it appears at a free spot: nothing waits for a pinch, so no placement hint
    var cap = makeText("Imagine Caption", 60, new vec3(0, captionY(0), WORLD_Z), new vec4(0.85, 0.95, 1, 1));
    styleCaption(cap.text);
    cap.job = null;
    cap.text.text = "Imagining '" + prompt + "'… 0s"; cap.text.renderOrder = 100;
    var job = { hero: true, n: n, prompt: prompt, t0: elapsed, state: "pending", result: null, cap: cap, capUntil: 0, cancel: null, reason: "", timeout: imagineTimeout };
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
            placeCaption(job, capSlot(job));
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
script.api.generate = function (prompt, opts, cb) { return imagineGen ? imagineGen(prompt, cb, opts) : null; };   // raw generator access (model-regeneration harness): opts {refine}, cb {onSuccess(asset, url), onFail(reason)}
script.api.imagine = imagine;
script.api.imagineTimeout = function (sec) { if (sec !== undefined) { imagineTimeout = sec; } return imagineTimeout; };
script.api.imagineJobs = imagineJobs;
script.api.test.imagineState = function (i) { var n = nodes[i]; return n && n.job ? n.job.state : "none"; };
