// @input SceneObject nodeTemplate
// @input SceneObject linkTemplate
// @input float strength = 0.8
// @input bool debugAutoToggle = false
// @input bool demoPreset = false
// @input Component.Camera camera

// RULESHIFT system: a dynamic set of nodes (max MAX_NODES) + links {A,B,rule,visual}.
// Nodes are spawned from the Create palette (or the demo preset). Each frame every active link adds a force to
// both of its nodes; forces are summed per node, scaled by the node's weight, then integrated. Rules change live.
var RULES = { ATTRACT: "ATTRACT", REPEL: "REPEL", COLLISION_TRIGGER: "COLLISION_TRIGGER" };
var RULE_ORDER = [RULES.ATTRACT, RULES.REPEL, RULES.COLLISION_TRIGGER];
var RULE_COLOR = {
    ATTRACT: new vec4(1.0, 0.55, 0.15, 1),  // warm
    REPEL: new vec4(0.2, 0.6, 1.0, 1),      // cool
    COLLISION_TRIGGER: new vec4(0.8, 0.3, 1.0, 1) // violet
};
var NODE_COLORS = [new vec4(1.0, 0.0, 0.35, 1), new vec4(0.0, 0.85, 1.0, 1), new vec4(1.0, 0.9, 0.0, 1)]; // hot pink, electric cyan, vivid yellow
var MAX_NODES = 8;
var WORLD_Z = -95;
var SIZES = { S: 7, M: 10, L: 14 };            // node scale in cm (diameter of the bounding sphere)
var WEIGHTS = { light: 1.6, heavy: 0.5 };      // multiplies how strongly forces move the node
var BOUNCES = { low: 0, high: 0.85 };          // restitution on collisions and walls

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
function addGlow(n) {
    // soft round halo: three nested, very transparent additive spheres (never a scaled copy of the shape, which reads as an outline)
    n.glow = [];
    [[2.2, 0.05], [1.75, 0.10], [1.35, 0.18]].forEach(function (L, li) {
        var o = global.scene.createSceneObject("Glow " + li);
        o.setParent(n.obj); o.layer = n.obj.layer;
        var v = o.createComponent("Component.RenderMeshVisual");
        v.mesh = SPHERE_MESH; v.mainMaterial = SPHERE_MAT.clone();
        var p = v.mainPass;
        p.blendMode = BlendMode.Add; p.depthWrite = false;
        p.baseColor = new vec4(n.color.r * L[1], n.color.g * L[1], n.color.b * L[1], L[1]);
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
        radius: radius, baseScale: scale, pulse: -1, dragging: false, color: col, rmv: rmv, parts: partList, fullMesh: getShapeMesh(shape), shape: shape, size: size,
        accel: opts.accel !== undefined ? opts.accel : (WEIGHTS[opts.weight] || 1),
        rest: opts.rest !== undefined ? opts.rest : (BOUNCES[opts.bounce] || 0), glowOn: !!opts.glow, glow: [] };
    setNodeColor(n, col);
    nodes.push(n);
    if (shape === "sphere" && opts.shine !== false) { addShine(n); }
    if (opts.glow) { addGlow(n); }
    pendingBinds.push({ kind: "node", n: n });
    pendingPlace = n;
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
script.createEvent("TouchStartEvent").bind(function (e) { placeAtScreen(e.getTouchPosition()); });

// ---------- links ----------
var HALO_SCALE = 1.7;
function applyColor(c) { if (c.rmv && c.rmv.mainPass) { c.rmv.mainPass.baseColor = RULE_COLOR[c.rule]; } }
function makeSlot(A, B) {
    var visual = cloneTemplate(LINK_TMPL, "Link " + A.obj.name + "-" + B.obj.name);
    var d = Math.max(A.pos.sub(B.pos).length, 0.1);
    var c = { A: A, B: B, rule: RULES.ATTRACT, visual: visual, rmv: visual.getComponent("Component.RenderMeshVisual"),
        cooldownUntil: 0, baseDist: d };
    // Parent keeps unit scale + the (invisible) collider; a child object carries the thin visible mesh.
    var pmesh = c.rmv.mesh, pmat = c.rmv.mainMaterial;
    c.rmv.enabled = false;
    var vo = global.scene.createSceneObject("Link Visual");
    vo.setParent(visual); vo.layer = visual.layer;
    c.rmv = vo.createComponent("Component.RenderMeshVisual");
    c.rmv.mesh = pmesh; c.rmv.mainMaterial = pmat.clone();
    c.visTr = vo.getTransform();
    var mn = pmesh.aabbMin, mx = pmesh.aabbMax;
    c.mW = Math.max(mx.x - mn.x, 0.0001); c.mL = Math.max(mx.y - mn.y, 0.0001); c.mD = Math.max(mx.z - mn.z, 0.0001);
    c.mCenter = new vec3((mx.x + mn.x) / 2, (mx.y + mn.y) / 2, (mx.z + mn.z) / 2);
    visual.getTransform().setLocalScale(vec3.one());
    c.collider = visual.getComponent("Component.ColliderComponent");
    c.pop = -1; c.active = false;
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
    c.visual.destroy(); c.labelObj.destroy();
}
function refreshConnections() {
    connections.length = 0;
    slots.forEach(function (c) { if (c.active) { connections.push(c); } });
}
function activateLink(c, rule, quiet) {
    c.active = true; c.rule = rule; c.cooldownUntil = 0;
    c.visual.enabled = true; c.labelObj.enabled = true;
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
function pressStartNode(n) { n.dragging = true; n.tapT = elapsed; n.tapP = n.tr.getLocalPosition(); }
function pressEndNode(n, allowTap) {
    if (nodeIndex(n) < 0) { return; }
    n.dragging = false; var p = n.tr.getLocalPosition(); n.pos = new vec3(p.x, p.y, p.z); n.vel = vec3.zero();
    // only a short press that barely moved counts as a tap-select; drags never do
    if (allowTap && elapsed - n.tapT < 0.35 && p.distance(n.tapP) < 1.5) { handleTapNode(n); }
}
function clearLinks() {
    slots.forEach(function (c) { c.active = false; c.visual.enabled = false; c.labelObj.enabled = false; });
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

function cycleRule(c, why) { setRule(c, RULE_ORDER[(RULE_ORDER.indexOf(c.rule) + 1) % RULE_ORDER.length], why); }
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

var TOUCH_COOLDOWN = 1.0, PULSE_TIME = 0.5, PULSE_AMOUNT = 0.9;
function flip(rule) { return rule === RULES.ATTRACT ? RULES.REPEL : (rule === RULES.REPEL ? RULES.ATTRACT : rule); }
function checkCollisions() {
    connections.slice().forEach(function (c) {
        if (c.rule !== RULES.COLLISION_TRIGGER || elapsed < c.cooldownUntil) { return; }
        var A = c.A, B = c.B;
        if (A.pos.distance(B.pos) > A.radius + B.radius + 0.1) { return; }
        c.cooldownUntil = elapsed + TOUCH_COOLDOWN;
        A.pulse = 0; B.pulse = 0;
        print("RULESHIFT COLLISION " + A.obj.name + "-" + B.obj.name);
        connections.forEach(function (o) {
            if (o === c || o.rule === RULES.COLLISION_TRIGGER) { return; }
            if (o.A === A || o.A === B || o.B === A || o.B === B) { setRule(o, flip(o.rule), "collision"); }
        });
    });
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
        Math.max(BOX_YMIN, Math.min(BOX_YMAX, p.y)),
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
var LABEL_TEXT = { ATTRACT: "ATTRACT", REPEL: "REPEL", COLLISION_TRIGGER: "ON COLLISION" };
var labelAlpha = 1;   // labels stay fully opaque in every mode
function updateLabel(c) {
    var A = c.A.pos, B = c.B.pos;
    var mid = A.add(B).uniformScale(0.5);
    var toCam = mid.uniformScale(-1 / Math.max(mid.length, 0.01));   // camera is at the origin
    var cx = 0; nodes.forEach(function (n) { cx += n.pos.x / nodes.length; });   // side links push their labels outward so labels don't pile up
    var dx = Math.max(-1, Math.min(1, (mid.x - cx) / 6)) * 6.5;
    c.labelTr.setWorldPosition(mid.add(toCam.uniformScale(22)).add(new vec3(dx, 7, 0)));
    c.label.text = LABEL_TEXT[c.rule];
    var k = RULE_COLOR[c.rule];
    c.label.textFill.color = new vec4(k.r, k.g, k.b, labelAlpha);
}
function updateVisual(c) {
    var A = c.A.pos, B = c.B.pos;
    var delta = B.sub(A);
    var dist = Math.max(delta.length, 0.01);
    var dir = delta.uniformScale(1 / dist);
    var tr = c.visual.getTransform();
    tr.setLocalPosition(A.add(B).uniformScale(0.5));
    tr.setLocalRotation(quat.rotationFromTo(UP, dir));
    var pk = 0;
    if (c.pop >= 0) { c.pop += lastDt; pk = c.pop >= POP_TIME ? 0 : Math.sin(Math.PI * c.pop / POP_TIME); if (c.pop >= POP_TIME) { c.pop = -1; } }
    var w = Math.min(c.A.radius, c.B.radius) * 0.5 * (1 + 1.2 * pk);   // visible cylinder diameter = quarter of the smaller radius*2
    var sx = w / c.mW, sy = dist / c.mL, sz = w / c.mD;
    c.visTr.setLocalScale(new vec3(sx, sy, sz));
    c.visTr.setLocalPosition(new vec3(-c.mCenter.x * sx, -c.mCenter.y * sy, -c.mCenter.z * sz));
    if (c.collider) {   // wide invisible tap target, shorter than the span so objects stay grabbable
        var sh = c.collider.shape;
        sh.size = new vec3(6, Math.max(dist - c.A.radius - c.B.radius, 1), 6);
        c.collider.shape = sh;
    }
}

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
        n.tr.setLocalPosition(n.pos); n.tr.setLocalScale(n.baseScale);
    });
    connections.forEach(function (c) { c.cooldownUntil = 0; updateVisual(c); });
    selNode = null;
    if (goalEnabled) { goalStage = 0; settleTime = 0; goalText.text = GOAL_1; nextText.text = "Next: " + GOAL_2; }
    setState("creation");
}
function clearAll() {
    for (var k = slots.length - 1; k >= 0; k--) { destroySlot(slots[k]); }
    for (var i = nodes.length - 1; i >= 0; i--) { nodes[i].obj.destroy(); }
    nodes.length = 0; refreshConnections(); updateEmptyHint();
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
    return { x: selNode.pos.x, y: selNode.pos.y, z: selNode.pos.z, r: selNode.radius };
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
script.api.test = {   // read/write hooks for RuleShiftTests.js
    nodes: nodes, connections: connections, slots: slots,
    tap: function (i) { handleTapNode(nodes[i]); },
    pressStart: function (i) { pressStartNode(nodes[i]); },
    pressEnd: function (i, allowTap) { pressEndNode(nodes[i], allowTap); },
    clearLinks: clearLinks, selected: function () { return selNode ? nodeIndex(selNode) : -1; }, setRule: setRule, cycleRule: cycleRule,
    pendingBinds: function () { return pendingBinds.length; },
    deleteNode: function (i) { return deleteNode(nodes[i]); },
    box: { x: BOX_X, yMin: BOX_YMIN, yMax: BOX_YMAX, zr: BOX_Z, buttonTop: -21 },
    goalStage: function () { return goalStage; },
    frames: function () { return frameCount; },
    linkColor: function (c) { var k = c.rmv.mainPass.baseColor; return k.r.toFixed(2) + "," + k.g.toFixed(2) + "," + k.b.toFixed(2); },
    place: function (i, v) { var n = nodes[i]; n.pos = new vec3(v.x, v.y, v.z); n.vel = vec3.zero(); n.tr.setLocalPosition(n.pos); },
    connect: function (i, j, rule) { var c = slotFor(nodes[i], nodes[j], true); if (!c.active) { activateLink(c, rule || RULES.ATTRACT, true); } return c; },
    glowInfo: function (i) { var n = nodes[i]; return n.glow.map(function (o) { var p = o.getComponent("Component.RenderMeshVisual").mainPass; return { blend: p.blendMode, alpha: p.baseColor.a }; }); }
};

var elapsed = 0, lastToggle = 0;
script.createEvent("UpdateEvent").bind(function (e) {
    var dt = Math.min(e.getDeltaTime(), 0.05);
    frameCount++;
    lastDt = dt;
    elapsed += e.getDeltaTime();
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
                sc.onTriggerStart.add(function () { if (c.active) { cycleRule(c, "tap"); } });
            }
        });
        if (done) { pendingBinds.splice(pi, 1); }
    }
    if (state === "live" && script.debugAutoToggle && elapsed - lastToggle >= 3 && connections.length) {
        lastToggle = elapsed;
        cycleRule(connections[0], "auto");
    }
    syncDragged();
    if (state === "live") {
        computeForces();
        integrate(dt);
    }
    for (var it = 0; it < 6; it++) {   // push apart, then re-clamp so a shove can never leave the box
        resolveOverlaps(it >= 2);
        nodes.forEach(function (n) { if (!n.dragging || it >= 2) { n.pos = clampToBox(n, n.pos); n.tr.setLocalPosition(n.pos); } });
    }
    if (state === "live") { checkCollisions(); }
    updatePulses(dt);
    updateSelection();
    hintObj.enabled = !!pendingPlace && !goalEnabled;
    updateGoal(Math.min(e.getDeltaTime(), 0.25));   // real time, so goal timers don't slow down at low frame rates
    connections.forEach(updateLabel);
    connections.forEach(updateVisual);
});
script.createEvent("OnStartEvent").bind(function () {
    if (script.demoPreset) { loadDemo(); }
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
    words.forEach(function (w) {
        var k;
        if (out.shape === null) { for (k in VOICE_WORDS.shape) { if (match(VOICE_WORDS.shape[k], w)) { out.shape = k; break; } } }
        if (out.color === null) { for (var ci = 0; ci < VOICE_WORDS.color.length; ci++) { if (match(VOICE_WORDS.color[ci], w)) { out.color = ci; break; } } }
        if (out.sizeKey === null) { for (k in VOICE_WORDS.size) { if (match(VOICE_WORDS.size[k], w)) { out.sizeKey = k; break; } } }
        if (out.glow === null) { if (match(VOICE_WORDS.glowOn, w)) { out.glow = true; } else if (match(VOICE_WORDS.glowOff, w)) { out.glow = false; } }
        if (out.weight === null) { for (k in VOICE_WORDS.weight) { if (match(VOICE_WORDS.weight[k], w)) { out.weight = k; break; } } }
        if (out.bounce === null) { for (k in VOICE_WORDS.bounce) { if (match(VOICE_WORDS.bounce[k], w)) { out.bounce = k; break; } } }
    });
    out.found = out.shape !== null;
    return out;
}
script.api.parseVoice = parseVoice;
