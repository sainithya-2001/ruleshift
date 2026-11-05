// @input SceneObject nodeA
// @input SceneObject nodeB
// @input SceneObject nodeC
// @input SceneObject connAB
// @input SceneObject connBC
// @input Component.ScriptComponent interactableAB
// @input Component.ScriptComponent interactableBC
// @input float strength = 0.8
// @input bool debugAutoToggle = false

// RULESHIFT system: N nodes + list of connections {nodeA,nodeB,rule,visual}.
// Each frame every connection adds a force to both of its nodes; forces are
// summed per node, then integrated. Rules can be changed at any time.
var RULES = { ATTRACT: "ATTRACT", REPEL: "REPEL", COLLISION_TRIGGER: "COLLISION_TRIGGER" };
var RULE_ORDER = [RULES.ATTRACT, RULES.REPEL, RULES.COLLISION_TRIGGER];
var RULE_COLOR = {
    ATTRACT: new vec4(1.0, 0.55, 0.15, 1),  // warm
    REPEL: new vec4(0.2, 0.6, 1.0, 1),      // cool
    COLLISION_TRIGGER: new vec4(0.8, 0.3, 1.0, 1) // violet
};

var NODE_COLORS = [new vec4(1.0, 0.25, 0.6, 1), new vec4(0.2, 1.0, 0.8, 1), new vec4(1.0, 0.9, 0.2, 1)]; // pink, mint, sun
var nodes = [];      // {obj, tr, pos:vec3, vel:vec3, force:vec3, initial:vec3}
var connections = []; // {a, b, rule, visual, baseScaleY, baseDist}

function meshRadius(obj) {
    var r = obj.getComponent("Component.RenderMeshVisual");
    var s = obj.getTransform().getWorldScale();
    if (r && r.mesh) { return (r.mesh.aabbMax.x - r.mesh.aabbMin.x) / 2 * s.x; }
    return s.x / 2;
}
var USE_EMISSIVE = true;
function setNodeColor(rmv, col) {   // PBR sphere mat has no colour param; Port_Emissive_N006 is the tintable one
    if (USE_EMISSIVE) { rmv.mainPass.Port_Emissive_N006 = new vec3(col.r, col.g, col.b); }
    else { rmv.mainPass.baseColor = col; }
}
function addNode(obj) {
    if (!obj) { return -1; }
    var nrmv = obj.getComponent("Component.RenderMeshVisual");
    var col = NODE_COLORS[nodes.length % NODE_COLORS.length];
    if (nrmv) { nrmv.mainMaterial = nrmv.mainMaterial.clone(); setNodeColor(nrmv, col); }
    var tr = obj.getTransform();
    var p = tr.getLocalPosition();
    nodes.push({ obj: obj, tr: tr, pos: new vec3(p.x, p.y, p.z), vel: vec3.zero(),
        force: vec3.zero(), initial: new vec3(p.x, p.y, p.z), radius: meshRadius(obj),
        baseScale: obj.getTransform().getLocalScale(), pulse: -1, color: col, rmv: nrmv });
    return nodes.length - 1;
}
var LINK_THICKNESS = 1.3, HALO_SCALE = 1.7;
function applyColor(c) {
    if (c.rmv && c.rmv.mainPass) {
        c.rmv.mainPass.baseColor = RULE_COLOR[c.rule];
        if (c.haloRmv) { var k = RULE_COLOR[c.rule]; c.haloRmv.mainPass.baseColor = new vec4(k.r * 0.35, k.g * 0.35, k.b * 0.35, 0.35); }
    } else { print("RULESHIFT no mainPass for " + c.visual.name); }
}
function addConnection(a, b, rule, visual) {
    if (a < 0 || b < 0 || !visual) { return null; }
    var d = Math.max(nodes[a].pos.sub(nodes[b].pos).length, 0.1);
    var c = { a: a, b: b, rule: rule, visual: visual, rmv: visual.getComponent("Component.RenderMeshVisual"),
        cooldownUntil: 0, baseScaleY: visual.getTransform().getLocalScale().y, baseDist: d };
    if (c.rmv) { c.rmv.mainMaterial = c.rmv.mainMaterial.clone(); }
    var vs = visual.getTransform().getLocalScale();
    c.thick = LINK_THICKNESS; c.pop = -1; c.baseScaleX = vs.x; c.baseScaleZ = vs.z;
    connections.push(c);
    var lo = global.scene.createSceneObject("Rule Label " + connections.length);
    c.label = lo.createComponent("Component.Text");
    c.label.size = 90; c.label.depthTest = true;
    c.label.horizontalAlignment = HorizontalAlignment.Center;
    c.label.verticalAlignment = VerticalAlignment.Center;
    c.labelTr = lo.getTransform();
    applyColor(c);
    return c;
}

var iA = addNode(script.nodeA);
var iB = addNode(script.nodeB);
var iC = addNode(script.nodeC);
addConnection(iA, iB, RULES.ATTRACT, script.connAB);
addConnection(iB, iC, RULES.REPEL, script.connBC);

function cycleRule(c, why) {
    setRule(c, RULE_ORDER[(RULE_ORDER.indexOf(c.rule) + 1) % RULE_ORDER.length], why);
}
function setRule(c, rule, why) {
    c.rule = rule;
    c.pop = 0;
    applyColor(c);
    print("RULESHIFT " + nodes[c.a].obj.name + "-" + nodes[c.b].obj.name + " rule -> " + rule + " (" + why + ")");
}

var LINK_GAP = 6;  // visible link length when attracted
var REST_ATTRACT_UNUSED = 6, REPEL_RANGE = 40, BOUND = 45, DAMPING = 3.0, MAX_SPEED = 40;
function computeForces() {
    nodes.forEach(function (n) { n.force = vec3.zero(); });
    connections.forEach(function (c) {
        var A = nodes[c.a], B = nodes[c.b];
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
    connections.forEach(function (c) {
        if (c.rule !== RULES.COLLISION_TRIGGER || elapsed < c.cooldownUntil) { return; }
        var A = nodes[c.a], B = nodes[c.b];
        if (A.pos.distance(B.pos) > A.radius + B.radius) { return; }
        c.cooldownUntil = elapsed + TOUCH_COOLDOWN;
        A.pulse = 0; B.pulse = 0;
        print("RULESHIFT COLLISION " + A.obj.name + "-" + B.obj.name);
        connections.forEach(function (o) {
            if (o === c || o.rule === RULES.COLLISION_TRIGGER) { return; }
            if (o.a === c.a || o.a === c.b || o.b === c.a || o.b === c.b) {
                setRule(o, flip(o.rule), "collision");
            }
        });
    });
}
function lerp4(a, b, t) { return new vec4(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t, 1); }
function updatePulses(dt) {
    nodes.forEach(function (n) {
        if (n.pulse < 0) { return; }
        n.pulse += dt;
        var k = n.pulse >= PULSE_TIME ? 0 : Math.sin(Math.PI * n.pulse / PULSE_TIME);
        if (n.pulse >= PULSE_TIME) { n.pulse = -1; }
        n.tr.setLocalScale(n.baseScale.uniformScale(1 + PULSE_AMOUNT * k));
        if (n.rmv) { setNodeColor(n.rmv, lerp4(n.color, new vec4(1, 1, 1, 1), k)); }
    });
}

function integrate(dt) {
    nodes.forEach(function (n) {
        // soft bounds keep everything inside the view
        n.vel = n.vel.add(n.force.uniformScale(dt)).uniformScale(Math.max(0, 1 - DAMPING * dt));
        var sp = n.vel.length;
        if (sp > MAX_SPEED) { n.vel = n.vel.uniformScale(MAX_SPEED / sp); }
        var p = n.pos.add(n.vel.uniformScale(dt));
        var cx = n.initial.x, cy = n.initial.y, cz = n.initial.z;
        p.x = Math.max(-BOUND, Math.min(BOUND, p.x));
        p.y = Math.max(cy - 25, Math.min(cy + 25, p.y));
        p.z = Math.max(cz - 25, Math.min(cz + 25, p.z));
        n.pos = p;
        n.tr.setLocalPosition(p);
    });
}

var UP = new vec3(0, 1, 0);
var POP_TIME = 0.4, lastDt = 0.016;
var LABEL_TEXT = { ATTRACT: "ATTRACT", REPEL: "REPEL", COLLISION_TRIGGER: "ON COLLISION" };
var labelAlpha = 1;
function updateLabel(c) {
    var A = nodes[c.a].pos, B = nodes[c.b].pos;
    c.labelTr.setWorldPosition(A.add(B).uniformScale(0.5).add(new vec3(0, 12, 18)));
    c.label.text = LABEL_TEXT[c.rule];
    var k = RULE_COLOR[c.rule];
    c.label.textFill.color = new vec4(k.r, k.g, k.b, labelAlpha);
}
function updateVisual(c) {
    var A = nodes[c.a].pos, B = nodes[c.b].pos;
    var delta = B.sub(A);
    var dist = Math.max(delta.length, 0.01);
    var tr = c.visual.getTransform();
    tr.setLocalPosition(A.add(B).uniformScale(0.5));
    tr.setLocalRotation(quat.rotationFromTo(UP, delta.uniformScale(1 / dist)));
    var s = tr.getLocalScale();
    var pk = 0;
    if (c.pop >= 0) { c.pop += lastDt; pk = c.pop >= POP_TIME ? 0 : Math.sin(Math.PI * c.pop / POP_TIME); if (c.pop >= POP_TIME) { c.pop = -1; } }
    var w = c.thick * (1 + 1.2 * pk);
    tr.setLocalScale(new vec3(c.baseScaleX * w, c.baseScaleY * dist / c.baseDist, c.baseScaleZ * w));
}

// Modes: creation (stationary, start) -> live <-> paused. Reset -> creation.
var state = "creation";
var stateListeners = [];
function setState(st) {
    state = st;
    print("RULESHIFT state -> " + st);
    stateListeners.forEach(function (f) { f(st); });
}
function resetWorld() {
    nodes.forEach(function (n) {
        n.pos = new vec3(n.initial.x, n.initial.y, n.initial.z);
        n.vel = vec3.zero(); n.force = vec3.zero(); n.pulse = -1;
        n.tr.setLocalPosition(n.pos); n.tr.setLocalScale(n.baseScale);
    });
    connections.forEach(function (c) { c.cooldownUntil = 0; updateVisual(c); });
    setState("creation");
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

var elapsed = 0, lastToggle = 0, lastLog = -1;
script.createEvent("UpdateEvent").bind(function (e) {
    var dt = Math.min(e.getDeltaTime(), 0.05);
    lastDt = dt;
    elapsed += e.getDeltaTime();
    if (state === "live" && script.debugAutoToggle && elapsed - lastToggle >= 3 && connections.length) {
        lastToggle = elapsed;
        var c0 = connections[0];
        cycleRule(c0, "auto");
    }
    if (state === "live") {
        computeForces();
        integrate(dt);
        checkCollisions();
    }
    updatePulses(dt);
    labelAlpha += ((state === "live" ? 0.2 : 1) - labelAlpha) * Math.min(1, dt * 6);
    connections.forEach(updateLabel);
    connections.forEach(updateVisual);
    if (Math.floor(elapsed) !== lastLog) {
        lastLog = Math.floor(elapsed);
        print("RULESHIFT t=" + elapsed.toFixed(0) + " " + connections.map(function (c) {
            return nodes[c.a].obj.name + "-" + nodes[c.b].obj.name + ":" + c.rule + " d=" +
                nodes[c.a].pos.distance(nodes[c.b].pos).toFixed(1);
        }).join(" | "));
    }
});

// SIK hand-interaction events must be subscribed during OnStartEvent.
script.createEvent("OnStartEvent").bind(function () {
    [script.interactableAB, script.interactableBC].forEach(function (inter, i) {
        var c = connections[i];
        if (inter && inter.onTriggerStart && c) {
            inter.onTriggerStart.add(function () { cycleRule(c, "tap"); });
        } else {
            print("RULESHIFT: assign Interactable for connection " + i);
        }
    });
});
// Opaque violet backing so the button labels read on any background (a copy of the link box).
try {
    var plate = script.connAB.copyWholeHierarchy(script.connAB);
    var pc = plate.getComponent("Component.ColliderComponent"); if (pc) { pc.destroy(); }
    plate.name = "Controls Backing"; plate.setParent(null);
    plate.getTransform().setWorldPosition(new vec3(0, -22, -80.6));
    plate.getTransform().setWorldRotation(quat.quatIdentity());
    plate.getTransform().setWorldScale(new vec3(40, 4.8, 0.4)); plate.getTransform().setWorldPosition(new vec3(0, -22, -80.6));
    var prmv = plate.getComponent("Component.RenderMeshVisual");
    prmv.mainMaterial = prmv.mainMaterial.clone();
    prmv.mainPass.baseColor = new vec4(0.3, 0.12, 0.6, 1);
    plate.enabled = true;
    print("RULESHIFT backing created");
} catch (err) { print("RULESHIFT backing failed: " + err); }
print("RULESHIFT radii: " + nodes.map(function (n) { return n.radius.toFixed(1); }).join(","));
print("RULESHIFT system: " + nodes.length + " nodes, " + connections.length + " connections");
