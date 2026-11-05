// @input SceneObject nodeA
// @input SceneObject nodeB
// @input SceneObject nodeC
// @input SceneObject connAB
// @input SceneObject connBC
// @input Component.ScriptComponent interactable
// @input float strength = 0.8
// @input bool debugAutoToggle = false

// RULESHIFT system: N nodes + list of connections {nodeA,nodeB,rule,visual}.
// Each frame every connection adds a force to both of its nodes; forces are
// summed per node, then integrated. Rules can be changed at any time.
var RULES = { ATTRACT: "ATTRACT", REPEL: "REPEL" };

var nodes = [];      // {obj, tr, pos:vec3, vel:vec3, force:vec3, initial:vec3}
var connections = []; // {a, b, rule, visual, baseScaleY, baseDist}

function addNode(obj) {
    if (!obj) { return -1; }
    var tr = obj.getTransform();
    var p = tr.getLocalPosition();
    nodes.push({ obj: obj, tr: tr, pos: new vec3(p.x, p.y, p.z), vel: vec3.zero(),
        force: vec3.zero(), initial: new vec3(p.x, p.y, p.z) });
    return nodes.length - 1;
}
function addConnection(a, b, rule, visual) {
    if (a < 0 || b < 0 || !visual) { return null; }
    var d = Math.max(nodes[a].pos.sub(nodes[b].pos).length, 0.1);
    var c = { a: a, b: b, rule: rule, visual: visual,
        baseScaleY: visual.getTransform().getLocalScale().y, baseDist: d };
    connections.push(c);
    return c;
}

var iA = addNode(script.nodeA);
var iB = addNode(script.nodeB);
var iC = addNode(script.nodeC);
addConnection(iA, iB, RULES.ATTRACT, script.connAB);
addConnection(iB, iC, RULES.REPEL, script.connBC);

function setRule(c, rule, why) {
    c.rule = rule;
    print("RULESHIFT " + nodes[c.a].obj.name + "-" + nodes[c.b].obj.name + " rule -> " + rule + " (" + why + ")");
}

var REST_ATTRACT = 6, REPEL_RANGE = 40, BOUND = 45, DAMPING = 3.0, MAX_SPEED = 40;
function computeForces() {
    nodes.forEach(function (n) { n.force = vec3.zero(); });
    connections.forEach(function (c) {
        var A = nodes[c.a], B = nodes[c.b];
        var delta = B.pos.sub(A.pos);
        var dist = Math.max(delta.length, 0.01);
        var dir = delta.uniformScale(1 / dist);   // A -> B
        var f = 0;
        if (c.rule === RULES.ATTRACT) {
            f = dist > REST_ATTRACT ? script.strength * 30 * Math.min(1, (dist - REST_ATTRACT) / 10) : 0;
        } else if (c.rule === RULES.REPEL) {
            f = dist < REPEL_RANGE ? -script.strength * 60 * (1 - dist / REPEL_RANGE) - 6 : 0;
        }
        // positive f pulls A toward B and B toward A
        A.force = A.force.add(dir.uniformScale(f));
        B.force = B.force.sub(dir.uniformScale(f));
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
function updateVisual(c) {
    var A = nodes[c.a].pos, B = nodes[c.b].pos;
    var delta = B.sub(A);
    var dist = Math.max(delta.length, 0.01);
    var tr = c.visual.getTransform();
    tr.setLocalPosition(A.add(B).uniformScale(0.5));
    tr.setLocalRotation(quat.rotationFromTo(UP, delta.uniformScale(1 / dist)));
    var s = tr.getLocalScale();
    tr.setLocalScale(new vec3(s.x, c.baseScaleY * dist / c.baseDist, s.z));
}

var elapsed = 0, lastToggle = 0, lastLog = -1;
script.createEvent("UpdateEvent").bind(function (e) {
    var dt = Math.min(e.getDeltaTime(), 0.05);
    elapsed += e.getDeltaTime();
    if (script.debugAutoToggle && elapsed - lastToggle >= 3 && connections.length) {
        lastToggle = elapsed;
        var c0 = connections[0];
        setRule(c0, c0.rule === RULES.ATTRACT ? RULES.REPEL : RULES.ATTRACT, "auto");
    }
    computeForces();
    integrate(dt);
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
    if (script.interactable && script.interactable.onTriggerStart && connections.length) {
        script.interactable.onTriggerStart.add(function () {
            var c = connections[0];
            setRule(c, c.rule === RULES.ATTRACT ? RULES.REPEL : RULES.ATTRACT, "pinch");
        });
    } else {
        print("RULESHIFT: assign the SIK Interactable component in the Inspector.");
    }
});
print("RULESHIFT system: " + nodes.length + " nodes, " + connections.length + " connections");
