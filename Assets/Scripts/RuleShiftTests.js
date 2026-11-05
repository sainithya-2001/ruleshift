// @input Component.ScriptComponent controller
// @input bool runTests = false
// @input bool liveImagine = false
// @input bool showCause = false
// @input string liveImaginePrompt = "a floating paper lantern"

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
        check("3 Collision: flip waits for the cause pulse (still ATTRACT right after the hit)", conns[1].rule === "ATTRACT", "link1=" + conns[1].rule);
        yield 0.8;
        check("3 Collision: other link flipped to REPEL once the pulse arrived", conns[1].rule === "REPEL", "link1=" + conns[1].rule);

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
        check("11 Glow: 3 soft round halos, additive blend, very transparent", gl.length === 3 && gl.every(function (g) { return g.blend === BlendMode.Add && g.alpha <= 0.2; }), JSON.stringify(gl));
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

        // 13: voice transcript parser (the ASR call itself is verified from Preview logs)
        var VC = [
            ["a big glowing red crystal", { shape: "crystal", color: 0, sizeKey: "L", glow: true }],
            ["small heavy blue cube", { shape: "cube", color: 1, sizeKey: "S", weight: "heavy" }],
            ["make me a tiny green ball", { shape: "sphere", color: 3, sizeKey: "S" }],
            ["Huge bouncy purple donut!", { shape: "torus", color: 5, sizeKey: "L", bounce: "high" }],
            ["a yellow gem, bright and light", { shape: "crystal", color: 2, glow: true, weight: "light" }],
            ["orange cone", { shape: "cone", color: 4 }],
            ["glowing cyan ring", { shape: "torus", color: 1, glow: true }],
            ["heavy large pink box", { shape: "cube", color: 0, sizeKey: "L", weight: "heavy" }],
            ["two little orbs", { shape: "sphere", sizeKey: "S" }],
            ["turquoise diamond that is shiny", { shape: "crystal", color: 1, glow: true }],
            ["a big red thing", { found: false }],
            ["glowing heavy blue", { found: false }],
            ["", { found: false }]
        ];
        VC.forEach(function (c) {
            var r = api.parseVoice(c[0]), ex = c[1], ok = true, k;
            if (ex.found === false) { ok = r.found === false; }
            else { ok = r.found === true; for (k in ex) { if (r[k] !== ex[k]) { ok = false; } } }
            check("13 Voice parse: '" + c[0] + "'", ok, JSON.stringify(r));
        });
        var lb = api.parseVoice("a light blue cube"), lg = api.parseVoice("light green sphere"), lw = api.parseVoice("a light blue cube that is light");
        check("13 Voice parse: 'light blue' is a colour, not the weight", lb.color === 1 && lb.weight === null && lg.color === 3 && lg.weight === null, JSON.stringify(lb));
        check("13 Voice parse: 'light' not before a colour still means light weight", lw.color === 1 && lw.weight === "light" && api.parseVoice("a light cube").weight === "light", JSON.stringify(lw));
        var vp = api.parseVoice("a cube");
        check("13 Voice parse: missing parameters stay null (palette defaults apply)", vp.color === null && vp.sizeKey === null && vp.glow === null && vp.weight === null && vp.bounce === null);
        check("13 Voice parse: first shape word wins", api.parseVoice("a cone and a cube").shape === "cone");

        // 14: Snap3D "imagine" with a STUBBED generator (no network, no token): pending orb, swap, failure, timeout
        var stub = { calls: [], cbs: [], cancelled: 0, mat: undefined, matCalls: 0 };
        var fakeAsset = function () {
            return { tryInstantiate: function (parent, mat) {
                stub.matCalls++; stub.mat = mat;
                var o = api.makePlate("Fake Model", 30, 9, 9, vec3.zero(), new vec4(1, 0.6, 0.2, 1));
                o.setParent(parent); o.getTransform().setLocalPosition(vec3.zero());
                return o;
            } };
        };
        api.setGenerator(function (prompt, cb) { stub.calls.push(prompt); stub.cbs.push(cb); return function () { stub.cancelled++; }; });
        api.clearAll(); yield 0.2; api.imagineTimeout(120);

        // 14a pending: a normal orb node, pulsing, with the caption
        var ia = api.imagine("a glowing jellyfish"); yield 0.15;
        var ja = nodes[ia].job, sa = nodes[ia].tr.getLocalScale().x; yield 0.12; var sb = nodes[ia].tr.getLocalScale().x; yield 0.12; var sc2 = nodes[ia].tr.getLocalScale().x;
        check("14 Imagine spawns a placeholder orb node while pending", ia === 0 && api.count() === 1 && ja.state === "pending" && stub.calls[0] === "a glowing jellyfish");
        check("14 Placeholder orb pulses", Math.abs(sa - sb) > 0.01 || Math.abs(sb - sc2) > 0.01, sa.toFixed(2) + "," + sb.toFixed(2) + "," + sc2.toFixed(2));
        check("14 Caption reads Imagining '<prompt>'… with a seconds counter", ja.cap && /^Imagining 'a glowing jellyfish'… \d+s$/.test(ja.cap.text.text), ja.cap ? ja.cap.text.text : "no caption");
        var capA = ja.cap.text.text, rA = nodes[ia].radius; yield 1.4;
        var capB = ja.cap.text.text, rB = nodes[ia].radius, secA = parseInt(capA.split("… ")[1]), secB = parseInt(capB.split("… ")[1]);
        check("14 Counter advances while waiting", secB > secA, capA.split("… ")[1] + " -> " + capB.split("… ")[1]);
        check("14 Placeholder orb slowly grows (radius and collision radius follow)", rB > rA + 0.05 && rB < nodes[ia].size * 0.5, rA.toFixed(2) + " -> " + rB.toFixed(2) + " of " + (nodes[ia].size * 0.5));
        check("14 Imagined objects are 1.5x the old size (18 cm footprint)", nodes[ia].size === 18);
        check("14 Orb is interactable like any node", T.pendingBinds() === 0 || nodes[ia].obj.getComponents("Component.ScriptComponent").length > 0);

        // 14b success: swap the model in as a normal node
        var nb = api.spawn({ shape: "cube", sizeKey: "S", color: [0, 0.85, 1] }); yield 0.15;
        stub.cbs[0].onSuccess(fakeAsset()); yield 0.3;
        var na = nodes[ia], mr = na.modelRoot;
        check("14 Success: state ok and the model replaced the orb", ja.state === "ok" && na.imagined === true && mr && na.rmv.enabled === false, ja.state);
        check("14 Success: a real material was passed to tryInstantiate", stub.matCalls === 1 && stub.mat !== null && stub.mat !== undefined);
        check("14 Success: caption removed", ja.cap === null);
        var cA = na.obj.getComponent("Component.ColliderComponent");
        check("14 Success: collider sized from the model bounds", cA && cA.shape && cA.shape.radius >= 0.3 && cA.shape.radius <= 0.75, cA && cA.shape ? "r " + cA.shape.radius.toFixed(3) : "no collider");
        check("14 Success: node radius still fits the stage footprint (size/2)", Math.abs(na.radius - na.size * 0.5) < 0.001 && na.size === 18 && Math.abs(ja.bounds.after - na.radius) < 0.15, "bounds " + ja.bounds.after.toFixed(2) + " radius " + na.radius.toFixed(2));
        check("14 Success: model is centred on the node", mr && mr.getTransform().getWorldPosition().distance(na.tr.getWorldPosition()) < na.size, "");
        // behaves as a normal node: draggable, linkable, all rules
        T.place(nb, new vec3(13, -4, z)); yield 0.1; T.pressStart(ia); na.tr.setLocalPosition(new vec3(-6, -4, z)); yield 0.15;
        check("14 Swapped node is draggable (position follows the hand)", Math.abs(na.pos.x + 6) < 0.3 && Math.abs(na.pos.y + 4) < 0.3, na.pos.x.toFixed(1) + "," + na.pos.y.toFixed(1));
        T.pressEnd(ia, false);
        T.place(ia, new vec3(-8, -4, z)); T.place(nb, new vec3(13, -4, z)); yield 0.1;   // 21 cm apart: beyond the ATTRACT rest distance (9 + 3.5 + 6 = 18.5)
        var lk = T.connect(ia, nb, "ATTRACT");
        check("14 Swapped node can be linked", lk && lk.active === true);
        api.activate(); yield 0.1;
        var d0 = na.pos.distance(nodes[nb].pos); yield 0.8; var d1 = na.pos.distance(nodes[nb].pos);
        check("14 Rule ATTRACT works on the swapped node", d1 < d0 - 0.2, d0.toFixed(1) + "->" + d1.toFixed(1));
        T.setRule(lk, "REPEL", "test"); var d2 = na.pos.distance(nodes[nb].pos); yield 0.8; var d3 = na.pos.distance(nodes[nb].pos);
        check("14 Rule REPEL works on the swapped node", d3 > d2 + 0.2, d2.toFixed(1) + "->" + d3.toFixed(1));
        check("14 Hero-size node stays inside the stage box, above the buttons, without overlapping its neighbour", Math.abs(na.pos.x) <= Math.min(T.box.x, api.view().stageR - na.radius) + 0.05 && na.pos.y <= T.box.yMax + 0.05 && na.pos.y - na.radius >= T.box.buttonTop - 0.05 && na.pos.distance(nodes[nb].pos) >= na.radius + nodes[nb].radius - 0.1, "pos " + na.pos.x.toFixed(1) + "," + na.pos.y.toFixed(1) + " r " + na.radius.toFixed(1));
        T.setRule(lk, "COLLISION_TRIGGER", "test");
        check("14 Rule COLLISION_TRIGGER set on the swapped node", lk.rule === "COLLISION_TRIGGER");
        stub.cbs[0].onFail("late failure after success"); yield 0.2;
        check("14 A second callback after success changes nothing", ja.state === "ok");
        api.clearAll(); yield 0.2;

        // 14c failure keeps the orb and shows the fallback caption
        api.reset(); stub.calls.length = 0; stub.cbs.length = 0;
        var ic = api.imagine("a sleepy cloud"); yield 0.1;
        var jc = nodes[ic].job; stub.cbs[0].onFail("boom"); yield 0.3;
        check("14 Failure: state failed, orb stays as the object", jc.state === "failed" && api.count() === 1 && nodes[ic].rmv.enabled === true && !nodes[ic].imagined);
        check("14 Failure: caption is \"Couldn't imagine that — here's an orb\"", jc.cap && jc.cap.text.text === "Couldn't imagine that — here's an orb", jc.cap ? jc.cap.text.text : "none");
        T.pressStart(ic); nodes[ic].tr.setLocalPosition(new vec3(4, -3, z)); yield 0.15; T.pressEnd(ic, false);
        check("14 Failed orb is still a working node (draggable)", Math.abs(nodes[ic].pos.x - 4) < 0.3 && Math.abs(nodes[ic].pos.y + 3) < 0.3, nodes[ic].pos.x.toFixed(1) + "," + nodes[ic].pos.y.toFixed(1));
        yield 4.4;
        check("14 Failure caption disappears after a few seconds", jc.cap === null);
        api.clearAll(); yield 0.2;

        // 14d timeout (shortened for the test) + late success ignored + generator cancelled
        stub.calls.length = 0; stub.cbs.length = 0; var cancelled0 = stub.cancelled;
        api.imagineTimeout(0.6);
        var id2 = api.imagine("a neon koi fish"); var jd = nodes[id2].job; yield 0.3;
        check("14 Timeout: still pending before the limit", jd.state === "pending");
        yield 0.6;
        check("14 Timeout: fails with a timeout reason and keeps the orb", jd.state === "failed" && jd.reason.indexOf("timeout") === 0 && api.count() === 1, jd.reason);
        check("14 Timeout: caption shows the fallback text", jd.cap && jd.cap.text.text.indexOf("here's an orb") > 0);
        check("14 Timeout: generator job was cancelled", stub.cancelled === cancelled0 + 1);
        stub.cbs[0].onSuccess(fakeAsset()); yield 0.3;
        check("14 Late success after timeout is ignored", jd.state === "failed" && !nodes[id2].imagined && stub.matCalls === 1);
        api.imagineTimeout(120);
        check("14 Default timeout is 120 s", api.imagineTimeout() === 120);
        api.clearAll(); yield 0.2;

        // 14e deleting the placeholder cancels the job; no generator installed -> immediate orb fallback
        stub.calls.length = 0; stub.cbs.length = 0; var cancelled1 = stub.cancelled;
        var ie = api.imagine("a crystal tree"); yield 0.1; T.deleteNode(ie); yield 0.2;
        check("14 Deleting the placeholder cancels the job and clears its caption", stub.cancelled === cancelled1 + 1 && api.imagineJobs.length === 0 && api.count() === 0);
        api.setGenerator(null);
        var if2 = api.imagine("anything"); yield 0.3;
        check("14 No generator: falls back to the orb", nodes[if2].job.state === "failed" && api.count() === 1);
        api.clearAll(); yield 0.2;
        api.setGenerator(function (prompt, cb) { stub.calls.push(prompt); stub.cbs.push(cb); return function () { stub.cancelled++; }; });

        // 14f prompt cleanup, voice routing and the Surprise me cycle (through the real controls component)
        check("14 cleanPrompt strips command words, keeps the description", api.cleanPrompt("Make me a glowing jellyfish!") === "a glowing jellyfish" && api.cleanPrompt("a neon koi fish.") === "a neon koi fish" && api.cleanPrompt("") === "");
        var ctl = null;
        global.scene.getRootObjectsCount && (function () {
            for (var ri = 0; ri < global.scene.getRootObjectsCount(); ri++) {
                var ro = global.scene.getRootObject(ri);
                if (ro.name === "RULESHIFT Controls") { ro.getComponents("Component.ScriptComponent").forEach(function (c) { if (c.handleTranscript && c.surpriseMe) { ctl = c; } }); }
            }
        })();
        check("14 Controls component found for UI-level checks", ctl !== null);
        if (ctl) {
            stub.calls.length = 0; stub.cbs.length = 0;
            ctl.handleTranscript("a big red cube"); yield 0.1;
            check("14 Voice with a palette shape word spawns a palette object, not Snap3D", api.count() === 1 && stub.calls.length === 0);
            api.clearAll(); yield 0.1;
            ctl.handleTranscript("a glowing jellyfish"); yield 0.1;
            check("14 Voice with no shape word goes to Snap3D (placeholder orb)", api.count() === 1 && stub.calls.length === 1 && stub.calls[0] === "a glowing jellyfish", JSON.stringify(stub.calls));
            ctl.handleTranscript(""); yield 0.1;
            check("14 Empty voice transcript does not call Snap3D", stub.calls.length === 1);
            api.clearAll(); yield 0.1; stub.calls.length = 0; stub.cbs.length = 0;
            for (var si = 0; si < 6; si++) { ctl.surpriseMe(); yield 0.05; }
            var EXP = ["a floating paper lantern", "a tiny planet with rings", "a crystal tree", "a sleepy cloud", "a neon koi fish", "a floating paper lantern"];
            check("14 Surprise me cycles the 5 prompts in order and wraps", JSON.stringify(stub.calls) === JSON.stringify(EXP), JSON.stringify(stub.calls));
            api.clearAll(); yield 0.2;
            // 15 toolbar: icon-first pills, one-word labels that never wrap, grouped [Play Reset] [Create Surprise Speak] [Unlink Clear]
            var tf = ctl.toolbarFit();
            check("15 Toolbar has the 7 one-word labels in group order", JSON.stringify(tf.labels) === JSON.stringify(["Play", "Reset", "Create", "Surprise", "Speak", "Unlink", "Clear"]), JSON.stringify(tf.labels));
            check("15 Toolbar labels are single words (no spaces, nothing to wrap)", tf.labels.every(function (l) { return /^[A-Za-z]+$/.test(l); }));
            check("15 Label fit pass completed", tf.ready === true && tf.size >= 14, "size " + tf.size);
            var fitsAll = tf.fit.length === 7 && tf.fit.every(function (f) { return f.width <= f.allowed + 0.001 && f.height <= f.allowedH + 0.001; });
            check("15 Every label fits its pill on one line (measured width and height)", fitsAll, tf.fit.map(function (f) { return f.label + " " + f.width.toFixed(2) + "/" + f.allowed.toFixed(2); }).join(" "));
            check("15 Label overflow is forced to single-line (never wraps)", ctl.toolbarPills.every(function (p) { return p.content.textComponent.horizontalOverflow === HorizontalOverflow.Overflow; }));
            var cx = tf.centers, d01 = cx[1] - cx[0], d12 = cx[2] - cx[1], d23 = cx[3] - cx[2], d34 = cx[4] - cx[3], d45 = cx[5] - cx[4], d56 = cx[6] - cx[5];
            check("15 Groups are separated by a larger gap than pills within a group", d12 > d01 + 0.5 && d45 > d34 + 0.5 && Math.abs(d01 - d23) < 0.01 && Math.abs(d23 - d34) < 0.01 && Math.abs(d01 - d56) < 0.01, [d01, d12, d23, d34, d45, d56].map(function (d) { return d.toFixed(2); }).join(","));
            check("15 All 7 pills fit between the screen edges", Math.abs(cx[0]) + tf.pillWidth / 2 <= api.view().halfW && Math.abs(cx[6]) + tf.pillWidth / 2 <= api.view().halfW);
            api.reset(); yield 0.2;
            check("15 Play pill reads Play when stopped", ctl.mainPill.content.text === "Play", ctl.mainPill.content.text);
            api.activate(); yield 0.2;
            check("15 Play pill reads Pause while live", ctl.mainPill.content.text === "Pause", ctl.mainPill.content.text);
            api.pause(); yield 0.2;
            check("15 Play pill reads Play when paused", ctl.mainPill.content.text === "Play", ctl.mainPill.content.text);
            api.reset(); yield 0.2;

            // 16 the Delete pill never overlaps an "Imagining…" / failure caption
            stub.calls.length = 0; stub.cbs.length = 0;
            var ix = api.imagine("a sleepy cloud"); yield 0.2;
            T.tap(ix); yield 0.4;
            var infoA = api.selectedInfo();
            check("16 Selected generating node reports busy and the Delete pill is hidden", infoA && infoA.busy === true && ctl.deleteObj.enabled === false && ctl.deletePlate.enabled === false, JSON.stringify(infoA));
            stub.cbs[0].onFail("x"); yield 0.4;
            check("16 Delete stays hidden while the failure caption shows", api.selectedInfo().busy === true && ctl.deleteObj.enabled === false);
            yield 4.4;
            check("16 Delete pill returns once the caption is gone", api.selectedInfo().busy === false && ctl.deleteObj.enabled === true && ctl.deletePlate.enabled === true);
            T.tap(ix); yield 0.2;
            api.clearAll(); yield 0.2;
        }

        // 17 visible cause chains: pulse travels first, the rule flips only on arrival, Reset leaves nothing behind
        api.loadDemo(); yield 0.5; api.reset(); yield 0.3;
        var z17 = nodes[0].initial.z, rs17 = nodes[0].radius + nodes[1].radius;
        check("17 No pulses before any event", T.cause.active() === 0 && T.cause.enabled() === 0);
        T.setRule(conns[0], "COLLISION_TRIGGER", "test"); T.setRule(conns[1], "ATTRACT", "test");
        api.activate(); yield 0.1;
        T.place(0, new vec3(-rs17 / 2, -5, z17)); T.place(1, new vec3(rs17 / 2, -5, z17)); T.place(2, new vec3(0, 8, z17));
        yield 0.1;
        var inf17 = T.cause.info();
        check("17 Collision spawns a pulse on the link it will flip", T.cause.active() === 1 && T.cause.enabled() === 1 && inf17[0].mode === "flip" && inf17[0].link === 1, JSON.stringify(inf17));
        var h1 = T.cause.headPos(0); yield 0.1; var h2 = T.cause.headPos(0);
        check("17 Pulse head travels (moves while in flight)", !!h1 && !!h2 && h1.distance(h2) > 1, h1 && h2 ? h1.distance(h2).toFixed(2) + " cm in 0.1s" : "no pulse");
        check("17 Rule has NOT changed while the pulse is in flight", conns[1].rule === "ATTRACT");
        var lab0 = conns[1].label.text, col0b = T.linkColor(conns[1]);
        check("17 Label text and colour are unchanged mid-flight (still the old rule)", lab0 === "ATTRACT" && conns[1].label.text === "ATTRACT" && T.linkColor(conns[1]) === col0b, "label " + lab0);
        var tt17 = 0.2, lastHead = null;
        while (conns[1].rule === "ATTRACT" && tt17 < 2) { lastHead = T.cause.headPos(0) || lastHead; yield 0.02; tt17 += 0.02; }
        check("17 Rule flips on arrival (~0.5 s after the hit)", conns[1].rule === "REPEL" && tt17 > 0.2 && tt17 <= 1.2, "t="+ tt17.toFixed(2) + " rule=" + conns[1].rule);
        check("17 Label text changes together with the rule on arrival", conns[1].label.text === "REPEL", "label " + conns[1].label.text);
        check("17 Pulse was at the far node when the rule flipped", !!lastHead && lastHead.distance(nodes[2].pos) < 4, lastHead ? lastHead.distance(nodes[2].pos).toFixed(2) + " cm away" : "none");
        check("17 Flipped link flashes on arrival", T.cause.flash(conns[1]) >= 0, "flash " + T.cause.flash(conns[1]).toFixed(2));
        yield 0.5;
        check("17 Link colour changed to the new rule after the flash", T.linkColor(conns[1]) !== col0b, col0b + " -> " + T.linkColor(conns[1]));
        check("17 Pulse released after arrival, flash over", T.cause.active() === 0 && T.cause.enabled() === 0 && T.cause.flash(conns[1]) < 0);
        // tap edit: rule changes at once, short pulse crosses the link, link flashes at the end
        var tr0 = conns[1].rule; T.cycleRule(conns[1], "tap");
        check("17 Tap edit changes the rule at once and sends a pulse", conns[1].rule !== tr0 && T.cause.active() === 1 && T.cause.info()[0].mode === "tap");
        var g17 = 0; while (T.cause.active() > 0 && g17++ < 60) { yield 0.02; }
        check("17 Tap pulse finishes and the link flashes", T.cause.active() === 0 && T.cause.flash(conns[1]) >= 0);
        yield 0.5;
        // pool is reused, never grows past its cap
        for (var sp = 0; sp < 30; sp++) { T.cycleRule(conns[sp % 2 === 0 ? 0 : 1], "spam"); }
        check("17 Pool stays capped under spam", T.cause.poolSize() <= 12 && T.cause.active() <= 12, "pool " + T.cause.poolSize());
        yield 0.8;
        check("17 Pooled pulses all released afterwards", T.cause.active() === 0 && T.cause.enabled() === 0, "active " + T.cause.active());
        // Reset mid-flight: nothing left over and the pending flip never happens
        api.reset(); yield 0.2;
        T.setRule(conns[0], "COLLISION_TRIGGER", "test"); T.setRule(conns[1], "ATTRACT", "test");
        api.activate(); yield 0.1;
        T.place(0, new vec3(-rs17 / 2, -5, z17)); T.place(1, new vec3(rs17 / 2, -5, z17)); T.place(2, new vec3(0, 8, z17));
        yield 0.15;
        check("17 Pulse in flight before Reset", T.cause.active() >= 1);
        api.reset();
        check("17 Reset leaves no pulse objects or flashes", T.cause.active() === 0 && T.cause.enabled() === 0 && conns.every(function (c) { return T.cause.flash(c) < 0; }), "active " + T.cause.active());
        yield 0.9;
        check("17 Reset cancels the pending flip", conns[1].rule === "ATTRACT", "link1=" + conns[1].rule);

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

// Live Snap3D check (needs a local token): one real generation through the REAL generator, timed, then linked to another object.
if (script.liveImagine) {
    script.createEvent("OnStartEvent").bind(function () {
        var api = script.controller.api, T = api.test, t0 = 0, st = "start", z = -95;
        var ev = script.createEvent("UpdateEvent");
        var elapsed = 0, linked = false;
        ev.bind(function (e) {
            elapsed += e.getDeltaTime();
            if (st === "start" && elapsed > 1) {
                api.clearAll();
                api.spawn({ shape: "sphere", color: [0, 0.85, 1], sizeKey: "M", name: "Anchor orb" });
                T.place(0, new vec3(-9, -4, z));
                api.imagineTimeout(120);
                t0 = elapsed; var idx = api.imagine(script.liveImaginePrompt);
                T.place(idx, new vec3(9, -4, z));
                print("RULESHIFT LIVE start '" + script.liveImaginePrompt + "' node " + idx); T.tap(idx);   // select the generating node: its caption shows and the Delete pill must stay hidden
                st = "wait";
            } else if (st === "wait") {
                var job = T.nodes[1] && T.nodes[1].job;
                if (job && job.state !== "pending" && !linked) {
                    linked = true;
                    print("RULESHIFT LIVE result state=" + job.state + (job.reason ? " reason=" + job.reason : "") + " after " + (elapsed - t0).toFixed(1) + "s");
                    if (job.state === "ok") {
                        T.connect(0, 1, "ATTRACT");
                        var n = T.nodes[1];
                        print("RULESHIFT LIVE linked | imagined=" + n.imagined + " radius=" + n.radius.toFixed(2) + " fit=" + JSON.stringify(job.bounds) + " links=" + T.connections.length);
                    }
                    st = "done";
                }
            }
        });
    });
}

// Visual check (not a test): stretch the cause pulse to 8 s, fire a collision, and print a marker mid-flight so a screenshot can catch it.
if (script.showCause) {
    script.createEvent("OnStartEvent").bind(function () {
        var api = script.controller.api, T = api.test, st = 0, el = 0, z = -95;
        script.createEvent("UpdateEvent").bind(function (e) {
            el += e.getDeltaTime();
            if (st === 0 && el > 1) {
                api.loadDemo(); T.cause.setTime(8); st = 1;
            } else if (st === 1 && el > 2) {
                var n = T.nodes, c = T.connections, rs = n[0].radius + n[1].radius;
                T.setRule(c[0], "COLLISION_TRIGGER", "x"); T.setRule(c[1], "ATTRACT", "x");
                api.activate();
                T.place(0, new vec3(-rs / 2 - 4, -5, z)); T.place(1, new vec3(rs / 2 - 4, -5, z)); T.place(2, new vec3(8, 6, z)); st = 2;
            } else if (st === 2 && el > 4.5) {
                print("RULESHIFT SHOWCAUSE mid-flight active=" + T.cause.active() + " rule=" + T.connections[1].rule); st = 3;
            }
        });
    });
}
