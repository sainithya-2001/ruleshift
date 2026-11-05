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
        var startCount = api.count();
        api.loadDemo(); yield 0.5;   // the demo preset is the starting set the original checks were written for
        check("0 Default scene starts empty (demo preset off)", startCount === 0, "count " + startCount);
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

        // 10. User-created links
        api.reset(); yield 0.2;
        check("10 Start: AB + BC linked, AC not", T.connections.length === 2 && !T.slots[2].active);
        T.tap(0); yield 0.1;
        check("10 Tap selects a sphere", T.selected() === 0);
        T.tap(2); yield 0.1;
        check("10 Second tap creates AC link (ATTRACT)", T.connections.length === 3 && T.slots[2].active && T.slots[2].rule === "ATTRACT" && T.selected() === -1, "links " + T.connections.length);
        check("10 New link has visual, collider, label", T.slots[2].visual.enabled && !!T.slots[2].collider && T.slots[2].labelObj.enabled && T.slots[2].label.text.length > 0);
        T.tap(2); T.tap(0); yield 0.1;
        check("10 No duplicate link (AC again)", T.connections.length === 3);
        T.tap(0); T.tap(1); yield 0.1;
        check("10 No duplicate link (existing AB)", T.connections.length === 3 && T.selected() === -1);
        T.tap(1); yield 0.05; T.tap(1); yield 0.1;
        check("10 Tapping same sphere cancels selection", T.selected() === -1 && T.connections.length === 3);
        // drag must not select
        T.pressStart(0); T.nodes[0].tr.setLocalPosition(new vec3(T.nodes[0].pos.x + 6, T.nodes[0].pos.y, z)); yield 0.1; T.pressEnd(0, true); yield 0.1;
        check("10 Dragging a sphere does not select it", T.selected() === -1);
        T.pressStart(1); yield 0.6; T.pressEnd(1, true); yield 0.1;
        check("10 Long press does not select", T.selected() === -1);
        T.pressStart(1); yield 0.1; T.pressEnd(1, true); yield 0.1;
        check("10 Short tap selects", T.selected() === 1);
        T.tap(1); yield 0.1;
        // new link physics + rule cycling
        api.reset(); yield 0.2;
        T.setRule(conns[0], "COLLISION_TRIGGER", "test"); T.setRule(conns[1], "COLLISION_TRIGGER", "test"); T.setRule(T.slots[2], "ATTRACT", "test");
        api.activate(); yield 0.1;
        T.place(0, new vec3(-16, 0, z)); T.place(2, new vec3(16, 0, z)); T.place(1, new vec3(0, -10, z));
        var d0 = nodes[0].pos.distance(nodes[2].pos); yield 2;
        var d1 = nodes[0].pos.distance(nodes[2].pos);
        check("10 New link physics: ATTRACT pulls A and C together", d1 < d0 - 3, d0.toFixed(1) + " -> " + d1.toFixed(1));
        T.setRule(T.slots[2], "REPEL", "test"); yield 3;
        var d2 = nodes[0].pos.distance(nodes[2].pos);
        check("10 New link physics: REPEL pushes them apart", d2 > d1 + 1, d1.toFixed(1) + " -> " + d2.toFixed(1));
        var rc = T.slots[2].rule; T.cycleRule(T.slots[2], "test"); yield 0.1;
        check("10 New link rule cycles", T.slots[2].rule !== rc);
        api.reset(); yield 0.2;
        check("10 Reset keeps user-created link", T.connections.length === 3 && T.slots[2].active);
        // Clear links
        T.clearLinks(); yield 0.2;
        check("10 Clear links removes all links", T.connections.length === 0 && T.slots.every(function (c) { return !c.active && !c.visual.enabled && !c.labelObj.enabled; }));
        var fr = T.frames(); api.activate(); yield 0.6;
        check("10 Sim runs fine with no links", T.frames() - fr >= 2 && api.getState() === "live");
        api.reset(); yield 0.2;
        T.tap(0); T.tap(1); yield 0.1;
        check("10 Link can be created again after clear", T.connections.length === 1 && T.slots[0].active);
        T.tap(1); T.tap(2); T.tap(0); T.tap(2); yield 0.1;
        check("10 All 3 pairs linkable", T.connections.length === 3);

        // 11. Create palette: spawning shapes/sizes, glow, weight, bounce, limit, delete, clear all, reset
        var SHAPES = ["sphere", "cube", "crystal", "cone", "torus"], SIZES = { S: 7, M: 10, L: 14 };
        api.clearAll(); yield 0.2;
        check("11 Clear all empties the world", api.count() === 0 && nodes.length === 0 && T.slots.length === 0 && conns.length === 0 && api.getState() === "creation");
        for (var si = 0; si < SHAPES.length; si++) {
            for (var sk in SIZES) {
                var idx = api.spawn({ shape: SHAPES[si], sizeKey: sk, color: [1, 0, 0.35] });
                yield 0.12;
                var nn = nodes[idx];
                var okMesh = !!nn && nn.fullMesh && nn.fullMesh.aabbMax.x - nn.fullMesh.aabbMin.x > 0.2 && nn.parts.length >= 1;
                check("11 Spawn " + SHAPES[si] + " " + sk + ": mesh, radius " + (SIZES[sk] / 2), okMesh && Math.abs(nn.radius - SIZES[sk] / 2) < 0.01 && Math.abs(nn.tr.getLocalScale().x - SIZES[sk]) < 0.01, "r=" + (nn ? nn.radius : "none"));
                check("11 Spawn " + SHAPES[si] + " " + sk + ": draggable (collider + interactable bound)", !!nn.obj.getComponent("Component.ColliderComponent") && T.pendingBinds() === 0);
                api.clearAll(); yield 0.05;
            }
        }
        // glow: layered translucent additive shells
        var gi = api.spawn({ shape: "sphere", glow: true, color: [0, 0.85, 1] }); yield 0.1;
        var gl = T.glowInfo(gi);
        check("11 Glow: 2 shells, additive blend, translucent", gl.length === 2 && gl.every(function (g) { return g.blend === BlendMode.Add && g.alpha < 1; }), JSON.stringify(gl));
        var ng = api.spawn({ shape: "cube", glow: false }); yield 0.1;
        check("11 No glow: no shells", T.glowInfo(ng).length === 0);
        api.clearAll(); yield 0.1;
        // limit
        for (var li = 0; li < 8; li++) { api.spawn({ shape: "cube", sizeKey: "S" }); }
        var over = api.spawn({ shape: "cube", sizeKey: "S" });
        check("11 Limit: 8 objects max, 9th refused", api.count() === 8 && over === -1, "count " + api.count());
        var okOverlap = true;
        for (var a1 = 0; a1 < nodes.length; a1++) { for (var b1 = a1 + 1; b1 < nodes.length; b1++) { if (nodes[a1].pos.distance(nodes[b1].pos) < nodes[a1].radius + nodes[b1].radius - 0.05) { okOverlap = false; } } }
        check("11 Spawned objects do not overlap each other", okOverlap);
        api.clearAll(); yield 0.1;
        // weight: light object is moved further than the heavy one by the same link force
        var wl = api.spawn({ shape: "sphere", weight: "light", pos: new vec3(-12, 0, -95) }), wh = api.spawn({ shape: "sphere", weight: "heavy", pos: new vec3(12, 0, -95) });
        T.connect(wl, wh, "ATTRACT"); api.activate(); yield 0.6;
        var dl = nodes[wl].pos.distance(nodes[wl].initial), dh = nodes[wh].pos.distance(nodes[wh].initial);
        check("11 Weight: light moves further than heavy", dl > dh * 1.5, "light " + dl.toFixed(2) + " heavy " + dh.toFixed(2));
        api.clearAll(); yield 0.1;
        // bounce: high bounce reverses at the wall, low bounce does not
        var bh = api.spawn({ shape: "sphere", bounce: "high", pos: new vec3(T.box.x - 2, -5, -95) }), bl = api.spawn({ shape: "sphere", bounce: "low", pos: new vec3(T.box.x - 2, 5, -95) });
        api.activate(); yield 0.05;
        nodes[bh].vel = new vec3(30, 0, 0); nodes[bl].vel = new vec3(30, 0, 0); yield 0.35;
        check("11 Bounce: high bounces off the wall, low does not", nodes[bh].vel.x < -1 && nodes[bl].vel.x > -0.5, "high " + nodes[bh].vel.x.toFixed(1) + " low " + nodes[bl].vel.x.toFixed(1));
        api.clearAll(); yield 0.1;
        // delete removes the object and its links
        var d0 = api.spawn({ shape: "cube", pos: new vec3(-12, 0, -95) }), d1 = api.spawn({ shape: "cone", pos: new vec3(0, 6, -95) }), d2 = api.spawn({ shape: "torus", pos: new vec3(12, 0, -95) });
        var del = nodes[d1];
        T.connect(d0, d1, "ATTRACT"); T.connect(d1, d2, "REPEL"); T.connect(d0, d2, "ATTRACT"); yield 0.1;
        check("11 Delete setup: 3 links", conns.length === 3);
        T.tap(d1); yield 0.05;
        var info = api.selectedInfo();
        check("11 Selecting an object exposes its position (for the Delete button)", !!info && Math.abs(info.x - del.pos.x) < 0.01);
        var okDel = api.deleteSelected(); yield 0.1;
        check("11 Delete removes object and its links", okDel && api.count() === 2 && conns.length === 1 && T.slots.every(function (c) { return c.A !== del && c.B !== del; }) && api.selectedInfo() === null, "nodes " + api.count() + " links " + conns.length);
        var fr2 = T.frames(); api.activate(); yield 0.5;
        check("11 Sim runs after delete", T.frames() - fr2 >= 2);
        api.reset(); yield 0.1;
        // reset keeps created objects, restores their positions
        var r0 = nodes[0].initial;
        nodes[0].pos = new vec3(r0.x + 5, r0.y + 3, r0.z); nodes[0].tr.setLocalPosition(nodes[0].pos);
        api.reset(); yield 0.2;
        check("11 Reset keeps created objects and restores positions", api.count() === 2 && nodes[0].pos.distance(nodes[0].initial) < 0.001 && conns.length === 1);
        api.clearAll(); yield 0.1;
        check("11 Clear all after creating removes everything", api.count() === 0 && T.slots.length === 0);

        // 12. Placement: a pinch on a surface puts the newest object there (virtual table plane; WorldQuery tried first)
        api.clearAll(); yield 0.1;
        var pi0 = api.spawn({ shape: "cube", sizeKey: "M", color: [1, 0.5, 0] }); yield 0.1;
        check("12 Spawned object waits for placement", api.pendingPlacement() === pi0 && pi0 === 0);
        var pn = nodes[pi0], tableY = api.tableY;
        var ray = function (x, y, zz) { var v = new vec3(x, y, zz); return v.uniformScale(1 / v.length); };
        var via = api.placeFromRay(vec3.zero(), ray(8, tableY, -95));
        check("12 Ray at the table hits the plane, object rests on it", via === "plane" && Math.abs(pn.pos.x - 8) < 0.05 && Math.abs(pn.pos.y - (tableY + pn.radius)) < 0.05 && Math.abs(pn.pos.z + 95) < 0.05, "pos " + pn.pos.x.toFixed(2) + "," + pn.pos.y.toFixed(2) + "," + pn.pos.z.toFixed(2));
        check("12 Placement clears the pending state", api.pendingPlacement() === -1);
        check("12 Placement moved the scene object too", pn.tr.getLocalPosition().distance(pn.pos) < 0.001);
        check("12 Placed position becomes the Reset position", pn.initial.distance(pn.pos) < 0.001);
        check("12 Pinch with nothing pending places nothing", api.placeFromRay(vec3.zero(), ray(-8, tableY, -95)) === null && Math.abs(pn.pos.x - 8) < 0.05);
        api.reset(); yield 0.1;
        check("12 Reset keeps the placed position", Math.abs(pn.pos.x - 8) < 0.05 && Math.abs(pn.pos.y - (tableY + pn.radius)) < 0.05);
        // far hit is clamped into the world box
        var pj = api.spawn({ shape: "cone", sizeKey: "S" }); yield 0.1;
        api.placeFromRay(vec3.zero(), ray(60, tableY, -300));
        var pc = nodes[pj];
        check("12 Far placement is clamped inside the world box", Math.abs(pc.pos.x) <= T.box.x + 0.01 && Math.abs(pc.pos.z + 95) <= T.box.zr + 0.01 && pc.pos.y >= T.box.yMin - 0.01, pc.pos.x.toFixed(1) + "," + pc.pos.y.toFixed(1) + "," + pc.pos.z.toFixed(1));
        // ray above the horizon never hits the table: falls back to the world depth plane
        var pk2 = api.spawn({ shape: "torus", sizeKey: "S" }); yield 0.1;
        var via2 = api.placeFromRay(vec3.zero(), ray(-6, 4, -95));
        check("12 Ray above the table falls back to the world plane", via2 === "world" && Math.abs(nodes[pk2].pos.x + 6) < 0.05 && Math.abs(nodes[pk2].pos.y - 4) < 0.05, "via " + via2);
        // screen-space path (camera ray + physics probe + WorldQuery attempt + plane fallback)
        var pm = api.spawn({ shape: "crystal", sizeKey: "M" }); yield 0.1;
        var res = api.placeAtScreen(new vec2(0.5, 0.82)); yield 1.2;
        check("12 Screen pinch on empty space places the object (WorldQuery: " + api.wqStatus() + ")", api.pendingPlacement() === -1 && Math.abs(nodes[pm].pos.y - (tableY + nodes[pm].radius)) < 0.05 && Math.abs(nodes[pm].pos.x) <= T.box.x + 0.01, "res " + res + " pos " + nodes[pm].pos.x.toFixed(1) + "," + nodes[pm].pos.y.toFixed(1) + "," + nodes[pm].pos.z.toFixed(1));
        // placed objects still behave: collide, stay in bounds
        api.activate(); yield 1;
        var inBox = nodes.every(function (n) { return Math.abs(n.pos.x) <= T.box.x + 0.01 && n.pos.y >= T.box.yMin - 0.01 && n.pos.y <= T.box.yMax + 0.01; });
        check("12 Placed objects stay in the world box while live", inBox);
        api.clearAll(); yield 0.1;

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
