// @input SceneObject nodeA
// @input SceneObject nodeB
// @input SceneObject connection
// @input Component.ScriptComponent interactable
// @input float strength = 0.8
// @input bool debugAutoToggle = true

// RULESHIFT prototype: pinch the node with the assigned SIK Interactable to
// switch rules. The simulation continues while the target separation changes.
var repel = false;
function ruleName() { return repel ? "REPEL" : "ATTRACT"; }
function setRepel(v, why) {
    repel = v;
    print("RULESHIFT rule -> " + ruleName() + " (" + why + ")");
}
var pA = script.nodeA.getTransform().getLocalPosition();
var pB = script.nodeB.getTransform().getLocalPosition();
var centerX = (pA.x + pB.x) * 0.5;
var startY = (pA.y + pB.y) * 0.5;
var startZ = (pA.z + pB.z) * 0.5;
var direction = pA.x <= pB.x ? -1 : 1;
var distance = Math.abs(pB.x - pA.x);
var initialDistance = Math.max(distance, 0.1);
var initialConnectionScaleY = script.connection.getTransform().getLocalScale().y;

print("RULESHIFT awake: nodeA=" + script.nodeA.name + " nodeB=" + script.nodeB.name +
    " connection=" + script.connection.name + " rule=" + ruleName() +
    " x=(" + pA.x.toFixed(1) + "," + pB.x.toFixed(1) + ")");
var elapsed = 0, lastToggle = 0, lastLog = -1;
var update = script.createEvent("UpdateEvent");
update.bind(function (eventData) {
    var dt = Math.min(eventData.getDeltaTime(), 0.05);
    elapsed += eventData.getDeltaTime();
    if (script.debugAutoToggle && elapsed - lastToggle >= 3) {
        lastToggle = elapsed;
        setRepel(!repel, "auto");
    }
    // Move the connected pair continuously. The rule can be changed mid-run.
    var targetDistance = repel ? 24 + script.strength * 20 : Math.max(6, 24 - script.strength * 15);
    distance += (targetDistance - distance) * Math.min(1, dt * 1.5);
    var halfDistance = distance * 0.5;
    var a = new vec3(centerX + direction * halfDistance, pA.y, pA.z);
    var b = new vec3(centerX - direction * halfDistance, pB.y, pB.z);
    script.nodeA.getTransform().setLocalPosition(a);
    script.nodeB.getTransform().setLocalPosition(b);

    var midpoint = new vec3(centerX, startY, startZ);
    script.connection.getTransform().setLocalPosition(midpoint);
    var scale = script.connection.getTransform().getLocalScale();
    scale.y = initialConnectionScaleY * (distance / initialDistance);
    script.connection.getTransform().setLocalScale(scale);
    if (Math.floor(elapsed) !== lastLog) {
        lastLog = Math.floor(elapsed);
        print("RULESHIFT t=" + elapsed.toFixed(1) + " rule=" + ruleName() + " Ax=" + a.x.toFixed(1) +
            " Bx=" + b.x.toFixed(1) + " dist=" + distance.toFixed(1) + " connScaleY=" + scale.y.toFixed(2));
    }
});

// SIK hand-interaction events must be subscribed during OnStartEvent.
var start = script.createEvent("OnStartEvent");
start.bind(function () {
    if (script.interactable && script.interactable.onTriggerStart) {
        script.interactable.onTriggerStart.add(function () {
            setRepel(!repel, "pinch");
        });
    } else {
        print("RULESHIFT: assign the SIK Interactable component in the Inspector.");
    }
});
