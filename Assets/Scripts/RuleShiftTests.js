// @input Component.ScriptComponent controller
// @input bool runTests = false

// Self-driving test harness for RULESHIFT. Set runTests=true, run Preview, read the RULESHIFT TEST lines.
if (script.runTests) {
    var api, T, nodes, conns, results = [], violations = { overlap: 0, bounds: 0, button: 0 }, monitorOn = false;
    var gen = null, wait = 0;

    function check(name, ok, info) {
        results.push(ok);
        print("RULESHIFT TEST " + (ok ? "PASS" : "FAIL") + " | " + name + (info ? " | " + info : ""));
    }
    function moved(a, b) { var m = 0; for (var i = 0; i < a.length; i++) { m = Math.max(m, a[i].distance(b[i])); } return m; }
    function snap() { return nodes.map(function (n) { return new vec3(n.pos.x, n.pos.y, n.pos.z); }); }
    function mon() {
        var bx = T.box;
        for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            if (Math.abs(n.pos.x) > bx.x + 0.01 || n.pos.y < bx.yMin - 0.01 || n.pos.y > bx.yMax + 0.01) { if (!violations.bounds) { print('RULESHIFT TEST first bounds violation node ' + i + ' ' + n.pos.x.toFixed(1) + ',' + n.pos.y.toFixed(1) + ' dragging=' + n.dragging); } violations.bounds++; }
            if (n.pos.y - n.radius < bx.buttonTop - 0.01) { violations.button++; }
            for (var j = i + 1; j < nodes.length; j++) {
                if (n.pos.distance(nodes[j].pos) < n.radius + nodes[j].radius - 0.05) { violations.overlap++; }
            }
        }
    }
    function* run() {
        yield 0.3;
        var z = nodes[0].initial.z;
        // 1. Activate -> spheres move
        api.reset(); yield 0.2;
        var p0 = snap(); api.activate(); yield 2;
        check("1 Activate: state live", api.getState() === "live");
        check("1 Activate: spheres move", moved(p0, snap()) > 0.5, "max move " + moved(p0, snap()).toFixed(2));

        // 2. cycleRule on each link
        var f0 = T.frames();
        for (var ci = 0; ci < conns.length; ci++) {
            var c = conns[ci], seen = {};
            for (var k = 0; k < 3; k++) {
                var r0 = c.rule, col0 = T.linkColor(c);
                T.cycleRule(c, "test"); yield 0.1;
                seen[c.rule] = true;
                check("2 cycleRule link" + ci + " step" + k, c.rule !== r0 && T.linkColor(c) !== col0, r0 + "->" + c.rule);
            }
            check("2 link" + ci + " visited all 3 rules", Object.keys(seen).length === 3);
        }
        check("2 update loop keeps running", T.frames() - f0 >= 3, (T.frames() - f0) + " frames");

        // 3. Collision trigger pulse + other link flips
        api.reset(); yield 0.2;
        T.setRule(conns[0], "COLLISION_TRIGGER", "test"); T.setRule(conns[1], "ATTRACT", "test");
        api.activate(); yield 0.1;
        var rs = nodes[0].radius + nodes[1].radius;
        T.place(0, new vec3(-rs / 2, -5, z)); T.place(1, new vec3(rs / 2, -5, z)); T.place(2, new vec3(0, 8, z));
        yield 0.08;
        check("3 Collision: pulse fires", nodes[0].pulse >= 0 || nodes[1].pulse >= 0);
        check("3 Collision: other link flipped to REPEL", conns[1].rule === "REPEL", "link1=" + conns[1].rule);

        // 4. Pause freezes, resume moves
        api.reset(); yield 0.2;
        T.setRule(conns[0], "ATTRACT", "test"); T.setRule(conns[1], "REPEL", "test");
        api.activate(); yield 0.5;
        api.pause(); yield 0.1;
        var pa = snap(); yield 0.6;
        check("4 Pause: positions frozen", moved(pa, snap()) < 0.001, "drift " + moved(pa, snap()).toFixed(4));
        api.resume(); yield 1;
        check("4 Resume: moving again", moved(pa, snap()) > 0.3, "move " + moved(pa, snap()).toFixed(2));

        // 5. Reset restores positions, keeps links and rules
        var rulesBefore = conns.map(function (c) { return c.rule; }).join();
        api.reset(); yield 0.2;
        var ok5 = nodes.every(function (n) { return n.pos.distance(n.initial) < 0.001 && n.tr.getLocalPosition().distance(n.initial) < 0.001; });
        check("5 Reset: initial positions restored", ok5);
        check("5 Reset: links and rules kept", conns.length === 2 && conns.map(function (c) { return c.rule; }).join() === rulesBefore, rulesBefore);
        check("5 Reset: back to creation", api.getState() === "creation");

        // 6. Simulated drag
        violations = { overlap: 0, bounds: 0, button: 0 }; monitorOn = true;
        api.activate(); yield 0.2;
        var y = nodes[2];
        y.dragging = true; y.tr.setLocalPosition(new vec3(100, -100, z)); yield 0.1;
        check("6 Drag clamped to box", Math.abs(y.pos.x) <= T.box.x + 0.01 && y.pos.y >= T.box.yMin - 0.01, "pos " + y.pos.x.toFixed(1) + "," + y.pos.y.toFixed(1));
        var tgt = nodes[0].pos;
        y.tr.setLocalPosition(new vec3(tgt.x + 1, tgt.y, tgt.z)); yield 0.1;
        var d = y.pos.distance(nodes[0].pos);
        check("6 Drag onto sphere: others pushed away, no overlap", d >= y.radius + nodes[0].radius - 0.05, "dist " + d.toFixed(2) + " need " + (y.radius + nodes[0].radius).toFixed(2));
        y.dragging = false; yield 0.2;

        // 7/8. Bounds + no overlap for 15 s live, rules cycling for chaos
        api.reset(); yield 0.2;
        api.activate();
        for (var t = 0; t < 15; t += 0.5) {
            if (t % 3 === 0) { T.cycleRule(conns[(t / 3) % 2], "chaos"); }
            yield 0.5;
        }
        monitorOn = false;
        check("7 Bounds: inside box over 15s live", violations.bounds === 0, violations.bounds + " bad frames");
        check("7 Bounds: never in button area", violations.button === 0, violations.button + " bad frames");
        check("8 No overlap in any frame (tests 6-7)", violations.overlap === 0, violations.overlap + " bad frames");

        // 9a. Challenge 1
        api.reset(); yield 0.2;
        api.activate(); yield 0.1;
        T.setRule(conns[0], "COLLISION_TRIGGER", "test"); T.setRule(conns[1], "COLLISION_TRIGGER", "test");
        var ry = nodes[2], pk = nodes[0], rr = ry.radius + pk.radius;
        ry.dragging = true; T.place(0, new vec3(-6, -3, z)); T.place(2, new vec3(-6 + rr, -3, z)); yield 0.1;
        check("9 Challenge 1 NOT triggered while dragging", T.goalStage() === 0, "stage " + T.goalStage());
        ry.dragging = false; yield 0.1;
        check("9 Challenge 1 triggers on touch, no drag", T.goalStage() === 1, "stage " + T.goalStage());
        // 9b. Challenge 2: triangle
        yield 3.3;
        check("9 Challenge 2 becomes active", T.goalStage() === 2, "stage " + T.goalStage());
        T.place(0, new vec3(-10, -8, z)); T.place(1, new vec3(10, -8, z)); T.place(2, new vec3(0, 9, z));
        yield 3;
        check("9 Challenge 2 triangle triggers", T.goalStage() === 3, "stage " + T.goalStage());

        api.reset();
        var pass = results.filter(function (r) { return r; }).length;
        print("RULESHIFT TEST SUMMARY: " + pass + "/" + results.length + " PASS" + (pass === results.length ? " - ALL PASS" : " - FAILURES"));
    }
    script.createEvent("OnStartEvent").bind(function () {
        api = script.controller.api; T = api.test; nodes = T.nodes; conns = T.connections;
        gen = run();
    });
    script.createEvent("UpdateEvent").bind(function (e) {
        if (!gen) { return; }
        if (monitorOn) { mon(); }
        wait -= e.getDeltaTime();
        if (wait > 0) { return; }
        var r = gen.next();
        if (r.done) { gen = null; } else { wait = r.value; }
    });
}
