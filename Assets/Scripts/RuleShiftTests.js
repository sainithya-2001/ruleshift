// @input Component.ScriptComponent controller
// @input bool runTests = false
// @input bool liveImagine = false
// @input bool genModels = false
// @input bool showCause = false
// @input bool showUniverse = false
// @input bool showRoom = false
// @input bool showUi = false
// @input bool roomPlay = false
// @input bool perfSweep = false
// @input bool showEditor = false
// @input bool showGrow = false
// @input bool showShots = false
// @input bool shotsPulses = false
// @input string liveImaginePrompt = "a floating paper lantern"

// Self-driving test harness for RULESHIFT. Set runTests=true, run Preview, read the RULESHIFT TEST lines.
if (script.runTests) {
    var api, T, nodes, conns, results = [], violations = { overlap: 0, bounds: 0, button: 0 }, monitorOn = false;
    var gen = null, wait = 0, SIM_STEP = 0.1;   // simulated seconds per frame: about the Preview's ~9 fps, so scenarios behave as designed, but deterministic under any host load

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
        T.setWorldScale(1);   // the original checks are written for the legacy stage scale; section 25 covers the room scale
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
        check("12 Screen pinch on empty space places the object (WorldQuery: " + api.wqStatus() + ")", api.pendingPlacement() === -1 && (api.wqStatus() === "hits" ? nodes[pm].pos.y >= T.box.yMin - 0.01 && nodes[pm].pos.y <= T.box.yMax + 0.01 : Math.abs(nodes[pm].pos.y - (tableY + nodes[pm].radius)) < 0.05) && Math.abs(nodes[pm].pos.x) <= T.box.x + 0.01, "res " + res + " pos " + nodes[pm].pos.x.toFixed(1) + "," + nodes[pm].pos.y.toFixed(1) + "," + nodes[pm].pos.z.toFixed(1));
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
        check("14 Success: the orb's Shine blob and glow are hidden (nothing white lingers on the model)", !!na.shine && na.shine.enabled === false && na.glow.every(function (o) { return o.enabled === false; }));
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
            var EXP = ["a glowing alien flower", "a floating crystal energy core", "a tiny floating island with trees", "a tiny planet with rings", "a floating paper lantern", "a glowing alien flower"];
            check("14 Surprise me cycles the 5 prompts in order and wraps", JSON.stringify(stub.calls) === JSON.stringify(EXP), JSON.stringify(stub.calls));
            api.clearAll(); yield 0.2;
            // 15 toolbar: three big icon-first pills [Create] [Play] [...], labels that never wrap
            var tf = ctl.toolbarFit();
            check("15 Toolbar has the 3 big labels in order", JSON.stringify(tf.labels) === JSON.stringify(["Create", "Play", "•••"]), JSON.stringify(tf.labels));
            check("15 Toolbar labels are single words (nothing to wrap)", tf.labels.every(function (l) { return /^[A-Za-z•]+$/.test(l); }));
            check("15 Label fit pass completed", tf.ready === true && tf.size >= 14, "size " + tf.size);
            var fitsAll = tf.fit.length === 3 && tf.fit.every(function (f) { return f.width <= f.allowed + 0.001 && f.height <= f.allowedH + 0.001; });
            check("15 Every label fits its pill on one line (measured width and height)", fitsAll, tf.fit.map(function (f) { return f.label + " " + f.width.toFixed(2) + "/" + f.allowed.toFixed(2); }).join(" "));
            check("15 Label overflow is forced to single-line (never wraps)", ctl.toolbarPills.every(function (p) { return p.content.textComponent.horizontalOverflow === HorizontalOverflow.Overflow; }));
            var cx = tf.centers, d01 = cx[1] - cx[0], d12 = cx[2] - cx[1];
            check("15 The 3 pills are evenly spaced and sit low in the right half (clear of the sideboard objects)", Math.abs(d01 - d12) < 0.01 && cx[0] - tf.pillWidth / 2 > 0, [d01, d12].map(function (d) { return d.toFixed(2); }).join(","));
            check("15 All 3 pills fit between the screen edges", Math.abs(cx[0]) + tf.pillWidth / 2 <= api.view().halfW && Math.abs(cx[2]) + tf.pillWidth / 2 <= api.view().halfW);
            api.reset(); yield 0.2;
            check("15 Play pill reads Play when stopped", ctl.mainPill.content.text === "Play", ctl.mainPill.content.text);
            api.activate(); yield 0.2;
            check("15 Play pill reads Pause while live", ctl.mainPill.content.text === "Pause", ctl.mainPill.content.text);
            api.pause(); yield 0.2;
            check("15 Play pill reads Play when paused", ctl.mainPill.content.text === "Play", ctl.mainPill.content.text);
            api.reset(); yield 0.2;
            // 15b status indicator, menus, Preview voice message
            check("15 Status reads Building in creation", T.statusText() === "Building", T.statusText());
            api.activate(); yield 0.2;
            check("15 Status reads Running while live", T.statusText() === "Running", T.statusText());
            api.pause(); yield 0.2;
            check("15 Status reads Paused when paused", T.statusText() === "Paused", T.statusText());
            api.reset(); yield 0.2;
            check("15 Menus start closed", T.menuState().create === false && T.menuState().more === false);
            T.openMenu("create"); yield 0.2;
            check("15 Create menu opens (and the More menu stays closed)", T.menuState().create === true && T.menuState().more === false);
            var mp = T.menuPills().map(function (p) { return p.text; });
            check("15 Create menu offers Surprise, Speak, saved creations and Basic building blocks", mp.indexOf("Surprise") >= 0 && mp.indexOf("Speak") >= 0 && mp.indexOf("House") >= 0 && mp.some(function (t) { return String(t).indexOf("Basic building blocks") === 0; }), JSON.stringify(mp));
            T.openMenu("more"); yield 0.2;
            check("15 Opening the More menu closes the Create menu", T.menuState().more === true && T.menuState().create === false);
            check("15 More menu offers Reset, Unlink and Clear", ["Reset", "Unlink", "Clear"].every(function (t) { return mp.indexOf(t) >= 0 || T.menuPills().some(function (p) { return p.text === t; }); }));
            T.closeMenus(); yield 0.1;
            check("15 Menus close", !T.menuState().create && !T.menuState().more);
            T.openMenu("create"); ctl.toggleSpeak(); yield 0.3;
            check("15 Speak in the Preview shows the Spectacles message (and closes the menu)", ctl.caption.sceneObject.enabled === true && ctl.caption.text === "Voice works on Spectacles" && !T.menuState().create, ctl.caption.text);
            ctl.caption.sceneObject.enabled = false; ctl.captionTimer = 0;
            check("15 Saved creations are offered", api.savedModels().length >= 1);
            var sv = api.spawnSaved(api.savedModels()[0]); yield 0.3;
            check("15 A saved creation spawns as a real object, placed (no pinch wait)", sv >= 0 && api.count() === 1 && api.pendingPlacement() === -1, "idx " + sv);
            api.clearAll(); yield 0.2;
            check("15 Unknown saved creation is refused", api.spawnSaved("Nothing") === -1);
            check("15 Discoveries are off by default (no card)", api.discoveriesOn() === false && api.cardInfo() === null);
            api.setFirstHint(true); yield 0.2;
            check("15 First-time hint shows on an empty stage", api.firstHintVisible() === true);
            api.spawn({ shape: "sphere", sizeKey: "M" }); yield 0.2;
            check("15 First-time hint disappears after the first object", api.firstHintVisible() === false);
            api.clearAll(); yield 0.2;
            check("15 First-time hint does not come back after Clear", api.firstHintVisible() === false);
            api.setFirstHint(false);
            // Connect / Remove pills beside the selected object
            var ca = api.spawn({ shape: "sphere", sizeKey: "M", pos: new vec3(-6, 0, -46) }), cb = api.spawn({ shape: "cube", sizeKey: "M", pos: new vec3(8, 0, -46) }); yield 0.2;
            T.tap(ca); yield 0.4;
            check("15 Selecting an object shows Connect and Remove pills", ctl.deleteObj.enabled === true && ctl.connectObj.enabled === true);
            var rt = ctl.deleteObj.getTransform().getWorldPosition(), ct2 = ctl.connectObj.getTransform().getWorldPosition();
            check("15 Connect sits above Remove, both at one x beside the object", Math.abs(rt.x - ct2.x) < 0.01 && ct2.y > rt.y, JSON.stringify([rt.x, ct2.x, rt.y, ct2.y]));
            check("15 Connect with exactly two objects links them", api.connectSelected() === true && T.connections.length === 1, "links " + T.connections.length);
            api.clearAll(); yield 0.2;

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
        check("17 Pulse was at the far node when the rule flipped", !!lastHead && lastHead.distance(nodes[2].pos) < 8, lastHead ? lastHead.distance(nodes[2].pos).toFixed(2) + " cm away" : "none");
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

        // 18 bug-fix round: edge-triggered collisions, captions above the stage, label nudging, gem glow, placement hint
        api.loadDemo(); yield 0.5; api.reset(); yield 0.3;
        var z18 = nodes[0].initial.z, rs18 = nodes[0].radius + nodes[1].radius;
        T.setRule(conns[0], "COLLISION_TRIGGER", "t"); T.setRule(conns[1], "COLLISION_TRIGGER", "t");
        api.activate(); yield 0.1;
        var c18 = conns[0], f18 = T.fires(c18);
        for (var k18 = 0; k18 < 50; k18++) { T.place(0, new vec3(-rs18 / 2, -5, z18)); T.place(1, new vec3(rs18 / 2, -5, z18)); T.place(2, new vec3(0, 8, z18)); yield 0.1; }
        check("18 Collision Trigger: 5 s of sustained contact fires exactly once", T.fires(c18) - f18 === 1, "fires " + (T.fires(c18) - f18));
        T.place(1, new vec3(rs18 / 2 + 0.8, -5, z18)); yield 0.2; T.place(1, new vec3(rs18 / 2, -5, z18)); yield 0.3;
        check("18 A tiny wobble (inside the re-arm gap) does not re-fire", T.fires(c18) - f18 === 1, "fires " + (T.fires(c18) - f18));
        T.place(1, new vec3(rs18 / 2 + 14, -5, z18)); yield 0.5;
        check("18 Separating does not fire", T.fires(c18) - f18 === 1);
        T.place(1, new vec3(rs18 / 2, -5, z18)); yield 0.3;
        check("18 Separating then touching again fires a second time", T.fires(c18) - f18 === 2, "fires " + (T.fires(c18) - f18));
        api.reset(); yield 0.2;

        // captions sit above the topmost object, never at a node
        api.clearAll(); yield 0.2;
        var st18 = { cbs: [] };
        api.setGenerator(function (pr, cb) { st18.cbs.push(cb); return function () { }; });
        var gem18 = api.spawn({ shape: "crystal", size: 10, pos: new vec3(-8.8, 5, z18) }), orb18 = api.spawn({ shape: "sphere", size: 10, pos: new vec3(8.8, 5, z18) });
        var im18 = api.imagine("a sleepy cloud"); yield 0.4;
        function topEdge() { var t = -1e9; nodes.forEach(function (n) { t = Math.max(t, n.pos.y + n.radius); }); return t; }
        var capA18 = api.imagineJobs[0].cap.tr.getWorldPosition();
        check("18 Imagining caption sits above the topmost object", capA18.y >= topEdge() + 3, "cap y " + capA18.y.toFixed(1) + " top " + topEdge().toFixed(1));
        check("18 Caption is not at its node", Math.abs(capA18.y - nodes[im18].pos.y) > nodes[im18].radius + 3);
        T.place(gem18, new vec3(-8.8, 8, z18)); yield 0.3;
        check("18 Caption follows the topmost object upward", api.imagineJobs[0].cap.tr.getWorldPosition().y >= topEdge() + 3, "cap y " + api.imagineJobs[0].cap.tr.getWorldPosition().y.toFixed(1) + " top " + topEdge().toFixed(1));
        var im18b = api.imagine("a neon koi fish"); yield 0.4;
        var capB18 = api.imagineJobs[1].cap.tr.getWorldPosition(), capA18b = api.imagineJobs[0].cap.tr.getWorldPosition();
        check("18 Two captions stack instead of overlapping", Math.abs(capB18.y - capA18b.y) >= 4, capA18b.y.toFixed(1) + " / " + capB18.y.toFixed(1));
        st18.cbs[0].onFail("x"); yield 0.4;
        check("18 Failure caption is above the topmost object too", api.imagineJobs[0].cap && api.imagineJobs[0].cap.tr.getWorldPosition().y >= topEdge() + 3);
        if (ctl) {
            ctl.showCaption("a voice caption", 3); yield 0.3;
            var vy = ctl.caption.sceneObject.getTransform().getWorldPosition().y;
            check("18 Voice caption is above the topmost object (and any Imagining captions)", vy >= topEdge() + 3, "voice y " + vy.toFixed(1) + " top " + topEdge().toFixed(1));
            ctl.caption.sceneObject.enabled = false; ctl.captionTimer = 0;
        }
        check("18 Imagined node does not wait for placement (no hint)", api.pendingPlacement() === -1);
        api.clearAll(); yield 0.2;

        // placement hint: only while something waits to be placed
        check("18 Hint hidden with nothing waiting", T.hintVisible() === false);
        var hp = api.spawn({ shape: "cone", size: 7 }); yield 0.3;
        check("18 Hint shown while an object waits for placement", T.hintVisible() === true && api.pendingPlacement() === hp);
        api.placeFromRay(vec3.zero(), ray(0, tableY, -95)); yield 0.3;
        check("18 Hint hidden once the object is placed", T.hintVisible() === false && api.pendingPlacement() === -1);
        var hp2 = api.spawn({ shape: "cone", size: 7 }); yield 0.2;
        T.pressStart(hp2); yield 0.1; T.pressEnd(hp2, false); yield 0.2;
        check("18 Dragging the waiting object counts as placing it (hint hidden)", T.hintVisible() === false && api.pendingPlacement() === -1);
        api.clearAll(); yield 0.2;

        // gem glow reads as strongly as the orb's
        var go = api.spawn({ shape: "sphere", size: 10, glow: true, color: [1, 0.6, 0.2], pos: new vec3(-9, 0, z18) }), gg = api.spawn({ shape: "crystal", size: 10, glow: true, color: [1, 0.6, 0.2], pos: new vec3(9, 0, z18) });
        var gi1 = T.glowInfo(go), gi2 = T.glowInfo(gg);
        check("18 Gem glow is at least 1.5x as strong as the orb's per layer (same layers, additive)", gi1.length === gi2.length && gi2.every(function (g, i) { return g.blend === gi1[i].blend && g.alpha >= gi1[i].alpha * 1.5; }), JSON.stringify(gi1.map(function (g) { return g.alpha.toFixed(2); })) + " vs " + JSON.stringify(gi2.map(function (g) { return g.alpha.toFixed(2); })));
        api.clearAll(); yield 0.2;

        // link labels never sit on a node
        var la = api.spawn({ shape: "crystal", size: 10, pos: new vec3(-8.8, 5, z18) }), lb = api.spawn({ shape: "sphere", size: 10, pos: new vec3(8.8, 5, z18) }), lc = api.spawn({ shape: "sphere", size: 18, pos: new vec3(0, -7, z18) });
        T.connect(la, lb, "ATTRACT"); T.connect(lc, lb, "ATTRACT"); T.connect(la, lc, "REPEL"); yield 0.5;
        var lbad = 0, lnud = [];
        T.connections.forEach(function (c) { var li = T.labelInfo(c); lnud.push((li.nudge || 0).toFixed(1)); if (!li.ext || li.hits) { lbad++; } });
        check("18 No link label overlaps a node's screen footprint", lbad === 0 && T.connections.length === 3, "nudges " + lnud.join(",") + " bad " + lbad);
        api.activate(); yield 4;
        lbad = 0; T.connections.forEach(function (c) { var li = T.labelInfo(c); if (!li.ext || li.hits) { lbad++; } });
        check("18 ...and stays clear while the nodes move", lbad === 0, "bad " + lbad);
        check("18 No two link labels overlap each other", T.labelOverlaps() === 0, "overlaps " + T.labelOverlaps());
        api.reset(); api.clearAll(); yield 0.2;

        // 19 recording setup: demoPreset opens on an empty stage; demoStage "chain" sets up gem / orb / cube with links ready
        script.controller.demoStage = "chain"; api.applyDemoSetup(); yield 0.5;
        var nm19 = nodes.map(function (n) { return n.obj.name; }).join(",");
        var minD19 = 1e9; for (var i19 = 0; i19 < nodes.length; i19++) { for (var j19 = i19 + 1; j19 < nodes.length; j19++) { minD19 = Math.min(minD19, nodes[i19].pos.distance(nodes[j19].pos) - nodes[i19].radius - nodes[j19].radius); } }
        check("19 chain: gem, orb and cube spawn, spread apart (no two touching)", nm19 === "Gem,Orb,Cube" && minD19 > 1.5, nm19 + " gap " + minD19.toFixed(1));
        var go19 = T.slots.filter(function (c) { return c.active && c.A.obj.name === "Gem"; })[0], oc19 = T.slots.filter(function (c) { return c.active && c.B.obj.name === "Cube"; })[0];
        check("19 chain: links ready (gem-orb ATTRACT, orb-cube COLLISION TRIGGER)", conns.length === 2 && !!go19 && !!oc19 && go19.rule === "ATTRACT" && oc19.rule === "COLLISION_TRIGGER");
        check("19 chain: starts in creation (press Play), no placement hint, gem glows", api.getState() === "creation" && T.hintVisible() === false && nodes[0].glowOn === true);
        yield 0.3; var lo19 = 0; T.connections.forEach(function (c) { var li = T.labelInfo(c); if (!li.ext || li.hits) { lo19++; } });
        check("19 chain: opening frame has no overlapping labels (node or label)", lo19 === 0 && T.labelOverlaps() === 0, "bad " + lo19 + " label-label " + T.labelOverlaps());
        api.activate(); var g19 = 0, fired19 = -1;
        while (g19 < 12 && T.fires(oc19) < 1) { yield 0.25; g19 += 0.25; }
        check("19 chain: the attract pull brings the orb to the cube and the collision fires", T.fires(oc19) >= 1, "after " + g19.toFixed(2) + "s");
        var g19b = 0; while (g19b < 4 && go19.rule !== "REPEL") { yield 0.2; g19b += 0.2; }
        check("19 chain: the pulse flips gem-orb to REPEL (chain reaction)", go19.rule === "REPEL", "rule " + go19.rule);
        api.reset(); yield 0.2;
        script.controller.demoStage = ""; api.applyDemoSetup(); yield 0.4;
        check("19 demoPreset opening: empty stage, no placement hint, creation state", nodes.length === 0 && T.hintVisible() === false && api.getState() === "creation");

        // 20 universe preset: saved models load instantly as normal nodes, links ready, chain fires on Play; Delete pill vs labels
        script.controller.demoStage = "universe"; api.applyDemoSetup(); yield 0.6;
        var nm20 = nodes.map(function (n) { return n.obj.name; }).join(",");
        check("20 universe: home, cat, lantern and flower load as models instantly", nm20 === "Home,Cat,Lantern,Flower" && nodes.every(function (n) { return n.imagined === true && !!n.modelRoot; }), nm20);
        var rr20 = nodes.map(function (n) { return n.radius; });
        check("20 universe: home ~1.5x and cat ~0.7x the base size, home heavy and cat light", Math.abs(rr20[0] / rr20[3] - 1.5) < 0.05 && Math.abs(rr20[1] / rr20[3] - 0.7) < 0.05 && rr20[2] < rr20[3] && nodes[0].accel < 1 && nodes[1].accel > 1, rr20.map(function (r) { return r.toFixed(1); }).join(","));
        function link20(x, y) { return T.slots.filter(function (c) { return c.active && ((c.A.obj.name === x && c.B.obj.name === y) || (c.A.obj.name === y && c.B.obj.name === x)); })[0]; }
        var cl20 = link20("Cat", "Lantern"), lf20 = link20("Lantern", "Flower"), ch20 = link20("Cat", "Home");
        check("20 universe: links ready (cat-lantern ATTRACT, lantern-flower COLLISION TRIGGER, cat-home ATTRACT)", conns.length === 3 && !!cl20 && !!lf20 && !!ch20 && cl20.rule === "ATTRACT" && lf20.rule === "COLLISION_TRIGGER" && ch20.rule === "ATTRACT");
        check("20 universe: creation state, no hint", api.getState() === "creation" && T.hintVisible() === false);
        yield 0.3; var lo20 = 0; T.connections.forEach(function (c) { var li = T.labelInfo(c); if (!li.ext || li.hits) { lo20++; } });
        check("20 universe: opening frame has no overlapping labels (node or label)", lo20 === 0 && T.labelOverlaps() === 0, "bad " + lo20 + " label-label " + T.labelOverlaps());
        // Delete pill: sits above the selected object's top edge, and labels keep clear of it
        T.tap(1); yield 0.5;
        var pr = T.pillRect(), sn = nodes[1];
        check("20 Connect/Remove pills sit beside the selected object (never over it)", !!pr && ((pr.x - pr.hw) >= (sn.pos.x + sn.radius) / -sn.pos.z - 0.0001 || (pr.x + pr.hw) <= (sn.pos.x - sn.radius) / -sn.pos.z + 0.0001), pr ? "pill x " + pr.x.toFixed(4) + " hw " + pr.hw.toFixed(4) + " node x " + (sn.pos.x / -sn.pos.z).toFixed(4) : "no pill");
        var lp20 = 0; T.connections.forEach(function (c) { var r = c.lblRect; if (r && pr && Math.abs(r.x - pr.x) < r.hw + pr.hw && Math.abs(r.y - pr.y) < r.hh + pr.hh) { lp20++; } });
        check("20 Link labels keep clear of the Delete pill", lp20 === 0, "overlapping " + lp20);
        var tr20 = lf20.lblRect; T.setTestPill({ x: tr20.x, y: tr20.y, hw: 0.04, hh: 0.02 }); yield 0.3;
        var r2 = lf20.lblRect, fk = { x: tr20.x, y: tr20.y, hw: 0.04, hh: 0.02 };
        check("20 A pill placed on a label pushes the label off it", !(Math.abs(r2.x - fk.x) < r2.hw + fk.hw && Math.abs(r2.y - fk.y) < r2.hh + fk.hh));
        T.setTestPill(null); T.tap(1); yield 0.2;
        var cat20 = nodes[1], hom20 = nodes[0], lan20 = nodes[2], flo20 = nodes[3];
        var catS = new vec3(cat20.pos.x, cat20.pos.y, cat20.pos.z), rest20 = cat20.radius + hom20.radius + 6;
        check("20 universe: the lantern starts far from the flower", lan20.pos.distance(flo20.pos) - lan20.radius - flo20.radius > 8, "gap " + (lan20.pos.distance(flo20.pos) - lan20.radius - flo20.radius).toFixed(1));
        api.activate();
        var chase = 0, tCh = 0;
        while (tCh < 20) { yield 0.5; tCh += 0.5; chase = Math.max(chase, cat20.pos.distance(catS)); }
        var cl20d = cat20.pos.distance(lan20.pos);
        print("RULESHIFT story chase " + chase.toFixed(1) + " cat-lantern " + cl20d.toFixed(1) + " lantern-flower gap " + (lan20.pos.distance(flo20.pos) - lan20.radius - flo20.radius).toFixed(1));
        check("20 story: nothing collides by itself for 20 s (lantern-flower never fire)", T.fires(lf20) === 0 && api.getState() === "live", "fires " + T.fires(lf20));
        check("20 story: the cat visibly chases the lantern 10-15 cm", chase >= 10 && chase <= 15, "travel " + chase.toFixed(1));
        check("20 story: no discoveries yet (no hand input, nothing touched)", T.discovered().join() === "", T.discovered().join());
        // drag the lantern along the bottom into the flower
        T.pressStart(2);
        var path = [[17, -10], [17, -4], [16.5, 0], [16, 3]];
        for (var pi20 = 0; pi20 < path.length; pi20++) { lan20.tr.setLocalPosition(new vec3(path[pi20][0], path[pi20][1], lan20.pos.z)); yield 0.3; }
        T.pressEnd(2, true);
        var g20 = 0; while (g20 < 3 && T.fires(lf20) < 1) { yield 0.1; g20 += 0.1; }
        check("20 story: dragging the lantern into the flower fires the Collision Trigger", T.fires(lf20) >= 1, "fires " + T.fires(lf20));
        var g20b = 0; while (g20b < 4 && cl20.rule !== "REPEL") { yield 0.2; g20b += 0.2; }
        check("20 story: the pulse flips cat-lantern to REPEL (chain reaction)", cl20.rule === "REPEL" && T.discovered().indexOf("chain") >= 0, "rule " + cl20.rule + " disc " + T.discovered().join());
        var tEnd20 = 0; while (tEnd20 < 10) { yield 0.5; tEnd20 += 0.5; }
        var pA20 = new vec3(cat20.pos.x, cat20.pos.y, cat20.pos.z); yield 0.5;
        var home20 = cat20.pos.distance(hom20.pos), drift20 = cat20.pos.distance(pA20);
        print("RULESHIFT story retreat dist " + home20.toFixed(1) + " rest " + rest20.toFixed(1) + " drift " + drift20.toFixed(2));
        check("20 story: the cat retreats home and settles there within 10 s of the flip", home20 <= rest20 + 1.5 && drift20 < 0.5, "dist " + home20.toFixed(1) + " rest " + rest20.toFixed(1) + " drift " + drift20.toFixed(2));
        var lo20b = 0; T.connections.forEach(function (c) { var li = T.labelInfo(c); if (!li.ext || li.hits) { lo20b++; } });
        var inb20 = nodes.every(function (n) { return Math.abs(n.pos.x) <= 17 + 0.01 && n.pos.y <= 8.01 && n.pos.y - n.radius >= -21; });
        check("20 story: all objects stay on the stage and no label overlaps a node or label", inb20 && lo20b === 0 && T.labelOverlaps() === 0, "inb " + inb20 + " lbl " + lo20b);
        api.reset(); yield 0.2;
        script.controller.demoStage = ""; api.applyDemoSetup(); yield 0.3;

        // 21 Transfer + Grow rules
        function mk21(x, y, key) { var i = api.spawn({ shape: "sphere", sizeKey: key || "M", bounce: "low", weight: "light" }); T.place(i, new vec3(x, y, -95)); nodes[i].initial = new vec3(x, y, -95); return i; }
        api.clearAll(); yield 0.2;
        mk21(-6, -6); mk21(6, -6);
        var tc21 = T.connect(0, 1, "TRANSFER");
        check("21 Transfer link has its own colour (green) and label", T.linkColor(tc21) === "0.20,0.90,0.35");
        api.activate(); nodes[0].vel = new vec3(20, 0, 0); nodes[1].vel = vec3.zero();
        var w21 = 0; while (w21 < 2 && T.fires(tc21) < 1) { yield 0.03; w21 += 0.03; }
        var vA = nodes[0].vel.length, vB = nodes[1].vel.length;
        check("21 Transfer: touching fires once", T.fires(tc21) === 1, "fires " + T.fires(tc21));
        check("21 Transfer: the faster object hands most of its velocity to the slower one", vB > 8 && vB > vA * 3 && nodes[1].vel.x > 0, "fast now " + vA.toFixed(1) + " slow now " + vB.toFixed(1));
        yield 1.2;
        check("21 Transfer: edge-triggered (no repeat while apart / still)", T.fires(tc21) === 1, "fires " + T.fires(tc21));
        api.reset(); yield 0.2;
        // Grow: +15% each touch, cap 2x, collision radius follows
        api.clearAll(); yield 0.2;
        mk21(-5, -6); mk21(5, -6);
        var gc21 = T.connect(0, 1, "GROW");
        check("21 Grow link has its own colour (pink-white)", T.linkColor(gc21) === "1.00,0.72,0.90");
        api.activate(); yield 0.4;
        var a21 = nodes[0], b21 = nodes[1];
        check("21 Grow: first touch grows both objects by 15% (radius follows)", Math.abs(a21.growK - 1.15) < 0.001 && Math.abs(b21.growK - 1.15) < 0.001 && Math.abs(a21.radius - 5.75) < 0.01 && Math.abs(b21.radius - 5.75) < 0.01, "k " + a21.growK.toFixed(3) + "," + b21.growK.toFixed(3) + " r " + a21.radius.toFixed(2));
        yield 2;   // the touch pulse has ended (it advances in capped 0.05 s steps, so it lasts over a second at Preview fps)
        check("21 Grow: visible scale matches the new size", Math.abs(a21.tr.getLocalScale().x - 11.5) < 0.05, "scale " + a21.tr.getLocalScale().x.toFixed(2));
        check("21 Grow: no second growth while they stay touching", Math.abs(a21.growK - 1.15) < 0.001);
        var rounds21 = 0;
        while (rounds21 < 9) {
            T.place(0, new vec3(-13, -6, -95)); T.place(1, new vec3(13, -6, -95)); yield 0.25;
            var d21 = a21.radius + b21.radius; T.place(0, new vec3(-d21 / 2, -6, -95)); T.place(1, new vec3(d21 / 2, -6, -95)); yield 0.25;
            rounds21++;
        }
        check("21 Grow: capped at 2x (never beyond) after many touches", Math.abs(a21.growK - 2) < 0.001 && Math.abs(b21.growK - 2) < 0.001 && Math.abs(a21.radius - 10) < 0.01, "k " + a21.growK.toFixed(3) + " r " + a21.radius.toFixed(2));
        api.reset(); yield 0.2;
        check("21 Reset restores sizes (radius and scale)", a21.growK === 1 && Math.abs(a21.radius - 5) < 0.001 && Math.abs(a21.tr.getLocalScale().x - 10) < 0.001 && Math.abs(b21.tr.getLocalScale().x - 10) < 0.001, "r " + a21.radius.toFixed(2));
        // Grow -> Collision Trigger chain (+ the trigger's pulse flips a third link)
        api.clearAll(); yield 0.2;
        mk21(-5, -8); mk21(5, -8); mk21(15.4, -8); mk21(10, 5);
        var gA = T.connect(0, 1, "GROW"), ct21 = T.connect(1, 2, "COLLISION_TRIGGER"), at21 = T.connect(2, 3, "ATTRACT");
        check("21 chain: before growth the trigger pair is apart and the pair would not touch at the original size", nodes[1].pos.distance(nodes[2].pos) - (nodes[1].radius + nodes[2].radius) > 0.2 && T.fires(ct21) === 0);
        api.activate();
        var w21b = 0; while (w21b < 3 && T.fires(ct21) < 1) { yield 0.1; w21b += 0.1; }
        check("21 chain: Grow made the pair touch and the Collision Trigger fired", T.fires(gA) >= 1 && nodes[1].growK > 1 && T.fires(ct21) >= 1, "grow fires " + T.fires(gA) + " ct fires " + T.fires(ct21) + " after " + w21b.toFixed(1) + "s");
        yield 1; 
        check("21 chain: the trigger's cause pulse flipped the third link to REPEL", at21.rule === "REPEL", "rule " + at21.rule);
        api.reset(); yield 0.2;
        // Models (saved/generated): same growth path
        script.controller.demoStage = "universe"; api.applyDemoSetup(); yield 0.6;
        var m21 = nodes[3], mr0 = m21.radius, ms0 = m21.modelRoot.getTransform().getWorldScale().x;
        T.growNode(m21); yield 0.1;
        check("21 Grow works for generated/saved models (radius and model scale follow)", Math.abs(m21.radius / mr0 - 1.15) < 0.01 && Math.abs(m21.modelRoot.getTransform().getWorldScale().x / ms0 - 1.15) < 0.02, "r " + (m21.radius / mr0).toFixed(3) + " s " + (m21.modelRoot.getTransform().getWorldScale().x / ms0).toFixed(3));
        api.reset(); yield 0.2;
        check("21 Reset restores the model's size", Math.abs(m21.radius - mr0) < 0.001 && Math.abs(m21.modelRoot.getTransform().getWorldScale().x / ms0 - 1) < 0.06);
        script.controller.demoStage = ""; api.applyDemoSetup(); yield 0.3;

        // 22 Rule editor: opens next to a link, applies instantly while the simulation runs, closes on selection or a tap elsewhere
        var RULES5 = ["ATTRACT", "REPEL", "COLLISION_TRIGGER", "TRANSFER", "GROW"];
        function ang(c) { var m = c.A.pos.add(c.B.pos).uniformScale(0.5), d = Math.max(-m.z, 1); return { x: m.x / d, y: m.y / d }; }
        api.loadDemo(); yield 0.4;
        var e0 = conns[0], e1 = conns[1];
        api.activate(); yield 0.3;
        T.openEditor(e0); yield 0.6;
        var pills22 = api.test.editorPills ? api.test.editorPills() : [];
        check("22 editor opens for the tapped link and is placed", T.editorOpen() === 0 && !!T.editorRect() && api.test.editorShown && api.test.editorShown() === true);
        check("22 editor lists all 5 rules in order (Attract, Repel, Collision Trigger, Transfer, Grow)", pills22.map(function (q) { return q.rule; }).join() === RULES5.join(), pills22.map(function (q) { return q.rule; }).join());
        check("22 editor highlights exactly the current rule", pills22.filter(function (q) { return q.selected; }).length === 1 && pills22.filter(function (q) { return q.selected; })[0].rule === e0.rule, e0.rule);
        var cols22 = pills22.map(function (q) { return q.fill.map(function (v) { return v.toFixed(2); }).join(","); });
        check("22 editor pills are coloured per rule (all different)", cols22.filter(function (c, i) { return cols22.indexOf(c) === i; }).length === 5, cols22.join(" | "));
        check("22 editor does not cover objects, labels, Delete pill, toolbar or the view edge", T.editorOverlaps() === 0, "overlaps " + T.editorOverlaps());
        var pr22 = T.editorRect(), m22 = ang(e0);
        check("22 editor sits next to its link", Math.hypot(pr22.x - m22.x, pr22.y - m22.y) < 0.33, "dist " + Math.hypot(pr22.x - m22.x, pr22.y - m22.y).toFixed(3));
        var f22 = T.frames(), p22 = snap(); yield 1;
        check("22 simulation keeps running while the editor is open", api.getState() === "live" && T.frames() - f22 >= 3 && moved(p22, snap()) > 0.05, "frames " + (T.frames() - f22) + " moved " + moved(p22, snap()).toFixed(2));
        // apply each rule
        var okAll = true, info22 = "";
        for (var ri = 0; ri < 5; ri++) {
            T.openEditor(e0); yield 0.4;
            var fr = T.frames(), pp = snap();
            api.test.pressEditorPill(ri); yield 0.3;
            var good = e0.rule === RULES5[ri] && T.editorOpen() === -1 && api.getState() === "live";
            if (!good) { okAll = false; info22 += " fail:" + RULES5[ri] + "=" + e0.rule + "/open" + T.editorOpen(); }
        }
        check("22 tapping a pill applies that rule instantly and closes the panel (all 5, simulation stays live)", okAll, info22);
        var fr2 = T.frames(); nodes[0].vel = new vec3(8, 0, 0); var px2 = nodes[0].pos.x; yield 1;   // kick one object: physics must still integrate after the edit
        check("22 simulation keeps running after an edit", T.frames() - fr2 >= 3 && api.getState() === "live" && Math.abs(nodes[0].pos.x - px2) > 0.5, "moved " + Math.abs(nodes[0].pos.x - px2).toFixed(2));
        // behaviour changes immediately: Attract -> Repel pushes the pair apart without pause or reset
        T.setRule(e0, "ATTRACT", "test"); T.setRule(e1, "ATTRACT", "test"); api.reset(); yield 0.2; api.activate(); yield 0.8;
        var dA = nodes[0].pos.distance(nodes[1].pos);
        T.openEditor(e0); yield 0.4; api.test.pressEditorPill(1); yield 1.2;
        check("22 live edit changes behaviour at once (Attract -> Repel separates the pair, no pause/restart)", e0.rule === "REPEL" && nodes[0].pos.distance(nodes[1].pos) > dA + 1 && api.getState() === "live", "before " + dA.toFixed(1) + " after " + nodes[0].pos.distance(nodes[1].pos).toFixed(1));
        // closing
        T.openEditor(e0); yield 0.2;
        var g1 = T.editorTouch(0.9, 0.9);
        check("22 a tap right after opening does not close it (grace)", T.editorOpen() === 0 && g1 === false);
        yield 0.5;
        var rc = T.editorRect(), inside = T.editorTouch(rc.x, rc.y);
        check("22 a tap on the panel keeps it open", T.editorOpen() === 0 && inside === false);
        var far = T.editorTouch(rc.x > 0 ? -0.25 : 0.25, 0.05);
        check("22 a tap elsewhere closes it", T.editorOpen() === -1 && far === true);
        T.toggleEditor(e0); yield 0.3; T.toggleEditor(e1); yield 0.3;
        check("22 tapping another link moves the editor to it", T.editorOpen() === 1);
        T.closeEditor();
        // follows the link when objects move
        api.pause(); yield 0.2;
        T.place(0, new vec3(-14, -8, -95)); T.place(1, new vec3(14, -8, -95)); T.place(2, new vec3(0, 5, -95)); yield 0.3;
        T.openEditor(e0); yield 0.5;
        var r1 = T.editorRect(), mm1 = ang(e0);
        T.place(0, new vec3(-14, 5, -95)); T.place(1, new vec3(0, -9, -95)); T.place(2, new vec3(14, 3, -95)); yield 0.5;
        var r2 = T.editorRect(), mm2 = ang(e0);
        check("22 editor follows its link when the objects move", Math.hypot(r2.x - r1.x, r2.y - r1.y) > 0.01 && Math.hypot(r2.x - mm2.x, r2.y - mm2.y) < 0.33 && T.editorOverlaps() === 0, "moved " + Math.hypot(r2.x - r1.x, r2.y - r1.y).toFixed(3) + " overlaps " + T.editorOverlaps());
        T.closeEditor(); api.resume(); api.reset(); yield 0.2;
        // dense layouts: universe (models + 3 labels) and a Delete pill; the panel never overlaps, live and still
        script.controller.demoStage = "universe"; api.applyDemoSetup(); yield 0.6;
        var bad22 = 0, samples22 = 0;
        for (var li = 0; li < conns.length; li++) {
            T.openEditor(conns[li]); yield 0.5; samples22++;
            if (T.editorOverlaps() !== 0) { bad22++; }
        }
        T.tap(1); yield 0.4; T.openEditor(conns[0]); yield 0.5; samples22++;
        if (T.editorOverlaps() !== 0) { bad22++; }
        T.tap(1); yield 0.2;
        api.activate();
        for (var tk = 0; tk < 12; tk++) { T.openEditor(conns[tk % conns.length]); yield 0.5; samples22++; if (T.editorOverlaps() !== 0) { bad22++; } }
        T.closeEditor();
        check("22 editor never overlaps objects, labels, Delete pill or toolbar (universe layout, still and live)", bad22 === 0, bad22 + " bad of " + samples22);
        T.openEditor(conns[0]); yield 0.4; T.clearLinks(); yield 0.3;
        check("22 editor closes when its link is removed", T.editorOpen() === -1);
        api.reset(); yield 0.2;
        script.controller.demoStage = ""; api.applyDemoSetup(); yield 0.3;

        // 23 Discoveries: five goals detected from system events (never from specific objects), each reachable from two different setups; dragging alone never earns one
        function mk23(x, y, key) { var i = api.spawn({ shape: "sphere", sizeKey: key || "M", bounce: "low", weight: "light" }); T.place(i, new vec3(x, y, -95)); nodes[i].initial = new vec3(x, y, -95); return i; }
        function D() { return T.discovered().join(); }
        function has(id) { return T.discovered().indexOf(id) >= 0; }
        function* waitFor(id, maxS) { var w = 0; while (w < maxS && !has(id)) { yield 0.1; w += 0.1; } return w; }
        function* dragTo(i, x, y) {   // a hand drag: press, glide in steps, release
            var n = nodes[i], sx = n.pos.x, sy = n.pos.y; T.pressStart(i);
            for (var k = 1; k <= 8; k++) { n.tr.setLocalPosition(new vec3(sx + (x - sx) * k / 8, sy + (y - sy) * k / 8, n.pos.z)); yield 0.1; }
            T.pressEnd(i, true); yield 0.2;
        }
        api.setDiscoveries(true);   // Discoveries are off by default; this section exercises the card
        // the card: collapsed by default, never over objects or the toolbar, ticks persist until Clear all
        api.clearAll(); yield 0.3; api.loadDemo(); yield 0.6;
        var ci = api.cardInfo ? api.cardInfo() : null;
        check("23 card exists, collapsed by default, in a top corner", !!ci && T.cardState().open === false && ci.expanded === false && ci.y > 0 && Math.abs(ci.x) > 0.1, ci ? JSON.stringify(ci) : "no card");
        check("23 collapsed card never covers objects, labels, Delete pill or the toolbar (demo)", T.cardOverlaps() === 0, "overlaps " + T.cardOverlaps());
        check("23 card header counts progress (0/5) and lists 5 goals", T.cardState().header === "Discoveries 0/5" && api.discoveries().length === 5, T.cardState().header);
        T.toggleCard(); yield 0.4;
        var ce = api.cardInfo();
        check("23 expanded card fits clear of everything and shows 5 rows", T.cardState().open === true && ce.expanded === true && T.cardOverlaps() === 0 && T.cardState().rows.length === 5, JSON.stringify(ce) + " ov " + T.cardOverlaps());
        T.toggleCard(); yield 0.2;
        script.controller.demoStage = "universe"; api.applyDemoSetup(); yield 0.6;
        var bad23 = 0; T.toggleCard(); yield 0.4; if (T.cardOverlaps() !== 0 || !api.cardInfo().expanded) { bad23++; } T.tap(1); yield 0.4; if (T.cardOverlaps() !== 0 || !api.cardInfo().expanded) { bad23++; } T.tap(1); T.toggleCard(); yield 0.4; if (T.cardOverlaps() !== 0) { bad23++; }
        check("23 card opens without overlap in the dense universe layout (also with the Delete pill showing; collapsed again afterwards)", bad23 === 0, "bad " + bad23);
        script.controller.demoStage = ""; api.applyDemoSetup(); yield 0.3;

        // dragging alone never earns a discovery (no links, then plain links, then Transfer+Grow links; creation and live)
        api.clearAll(); yield 0.2; mk23(-8, -6); mk23(8, -6); mk23(0, 4);
        yield* dragTo(0, 8, -6); yield 0.5;
        api.activate(); yield 0.3; yield* dragTo(2, 8, -5); yield* dragTo(1, 0, 4); yield 1;
        check("23 no discovery from dragging objects into each other (no links, creation then live)", D() === "", D());
        api.reset(); api.clearAll(); yield 0.2; mk23(-8, -6); mk23(8, -6); mk23(0, 4);
        T.connect(0, 1, "TRANSFER"); T.connect(1, 2, "GROW"); T.connect(0, 2, "ATTRACT"); api.activate(); yield 0.3;
        yield* dragTo(0, 8, -6); yield* dragTo(2, 8, -5); yield 1;
        check("23 no discovery from dragging into Transfer / Grow / Attract links (hand input is not a system event)", !has("contact") && !has("cradle") && !has("growth") && !has("rewrite"), D());

        // 1 First contact: setup A (two free spheres, one kicked) and setup B (a Collision Trigger pair kicked vertically from the other side)
        api.clearAll(); yield 0.2; mk23(-7, -6); mk23(7, -6); api.activate(); nodes[0].vel = new vec3(20, 0, 0);   // damping stops a kick within ~7 cm, so the pair starts a few cm apart
        var wA = yield* waitFor("contact", 3);
        check("23 First contact (setup A: a free sphere hits another)", has("contact"), "t " + wA.toFixed(1) + " " + D());
        check("23 discovery sparkles", T.sparkleActive() > 0, "sparks " + T.sparkleActive());
        api.clearAll(); yield 0.2; mk23(-3, 5); mk23(-3, -9); T.connect(0, 1, "COLLISION_TRIGGER"); api.activate(); nodes[1].vel = new vec3(0, 20, 0);
        var wB = yield* waitFor("contact", 3);
        check("23 First contact (setup B: a Collision Trigger pair collides vertically)", has("contact") && !has("chain"), "t " + wB.toFixed(1) + " " + D());

        // 2 Chain reaction: setup A (kicked Collision Trigger pair flips an Attract link) and setup B (dragged into the trigger flips a Repel link)
        api.clearAll(); yield 0.2; mk23(-9, -8); mk23(5, -8); mk23(8, 4); T.connect(0, 1, "COLLISION_TRIGGER"); T.connect(1, 2, "ATTRACT"); api.activate(); nodes[0].vel = new vec3(20, 0, 0);
        var wC = yield* waitFor("chain", 5);
        check("23 Chain reaction (setup A: a collision pulse flips an Attract link)", has("chain") && T.connections[1].rule === "REPEL", "t " + wC.toFixed(1) + " rule " + T.connections[1].rule + " " + D());
        api.clearAll(); yield 0.2; mk23(-12, -10); mk23(2, -10); mk23(2, 3); T.connect(0, 1, "COLLISION_TRIGGER"); T.connect(1, 2, "REPEL"); api.activate(); yield 0.3;
        yield* dragTo(0, -2, -10); var wD = yield* waitFor("chain", 5);
        check("23 Chain reaction (setup B: dragging into the trigger flips a Repel link)", has("chain") && T.connections[1].rule === "ATTRACT", "t " + wD.toFixed(1) + " rule " + T.connections[1].rule + " " + D());

        // 3 Growth spurt: setup A (a Grow pair touching again and again) and setup B (one object fed by two Grow links)
        api.clearAll(); yield 0.2; mk23(-5, -6); mk23(5, -6); T.connect(0, 1, "GROW"); api.activate(); yield 0.6;
        check("23 Growth spurt needs the maximum (one touch only is not enough)", !has("growth") && Math.abs(nodes[0].growK - 1.15) < 0.001, D());
        for (var r23 = 0; r23 < 9 && !has("growth"); r23++) {
            T.place(0, new vec3(-13, -6, -95)); T.place(1, new vec3(13, -6, -95)); yield 0.25;
            var d23 = nodes[0].radius + nodes[1].radius; T.place(0, new vec3(-d23 / 2, -6, -95)); T.place(1, new vec3(d23 / 2, -6, -95)); yield 0.25;
        }
        check("23 Growth spurt (setup A: a Grow pair reaches 2x)", has("growth") && Math.abs(nodes[0].growK - 2) < 0.001, "k " + nodes[0].growK.toFixed(2) + " rounds " + r23);
        api.clearAll(); yield 0.2; mk23(-14, -8, "S"); mk23(0, -8); mk23(14, -8, "S"); T.connect(0, 1, "GROW"); T.connect(1, 2, "GROW"); api.activate(); yield 0.3;
        for (var r23b = 0; r23b < 30 && !has("growth"); r23b++) {
            var m = nodes[1], l = nodes[0], rr = nodes[2];
            T.place(0, new vec3(m.pos.x - (l.radius + m.radius) + 0.3, -8, -95)); yield 0.3; T.place(0, new vec3(-14, -8, -95)); yield 0.3;
            T.place(2, new vec3(m.pos.x + (rr.radius + m.radius) - 0.3, -8, -95)); yield 0.3; T.place(2, new vec3(14, -8, -95)); yield 0.3;
        }
        check("23 Growth spurt (setup B: the middle object fed by two Grow links reaches 2x)", has("growth") && Math.abs(nodes[1].growK - 2) < 0.001, "k " + nodes[1].growK.toFixed(2) + " rounds " + r23b);

        // 4 Newton's cradle: setup A (a kicked Transfer pair) and setup B (a three-object Transfer row, vertical kick)
        api.clearAll(); yield 0.2; mk23(-12, -6); mk23(2, -6); T.connect(0, 1, "TRANSFER"); api.activate(); nodes[0].vel = new vec3(20, 0, 0);
        var wE = yield* waitFor("cradle", 3);
        check("23 Newton's cradle (setup A: a fast object hands its velocity to a resting one)", has("cradle"), "t " + wE.toFixed(1) + " " + D());
        api.clearAll(); yield 0.2; mk23(8, 6); mk23(8, -4); mk23(8, -14); T.connect(0, 1, "TRANSFER"); T.connect(1, 2, "TRANSFER"); api.activate(); nodes[0].vel = new vec3(0, -18, 0);
        var wF = yield* waitFor("cradle", 3);
        check("23 Newton's cradle (setup B: a vertical Transfer row)", has("cradle"), "t " + wF.toFixed(1) + " " + D());

        // 5 Rewrite reality: setup A (editor panel Attract -> Repel on an approaching pair) and setup B (tapping a link, vertical pair)
        api.clearAll(); yield 0.2; mk23(-13, -6); mk23(13, -6); var ra = T.connect(0, 1, "ATTRACT"); api.activate(); yield 0.7;
        check("23 Rewrite reality does not fire before any edit", !has("rewrite"), D());
        T.openEditor(ra); yield 0.4; api.test.pressEditorPill(1);
        var wG = yield* waitFor("rewrite", 4);
        check("23 Rewrite reality (setup A: editing Attract to Repel while the pair approaches)", has("rewrite") && ra.rule === "REPEL", "t " + wG.toFixed(1) + " rule " + ra.rule);
        api.clearAll(); yield 0.2; mk23(-4, 6); mk23(-4, -14); var rb = T.connect(0, 1, "ATTRACT"); api.activate(); yield 0.7;
        T.cycleRule(rb, "tap");
        var wH = yield* waitFor("rewrite", 4);
        check("23 Rewrite reality (setup B: tapping the link on a vertical pair)", has("rewrite"), "t " + wH.toFixed(1) + " rule " + rb.rule + " " + D());
        // an edit that reverses nothing (resting pair) or happens while paused/stopped does not count
        api.clearAll(); yield 0.2; mk23(-6, -6); mk23(6, -6); var rc = T.connect(0, 1, "ATTRACT"); T.setRule(rc, "REPEL", "test"); T.openEditor(rc); yield 0.3; api.test.pressEditorPill(0); yield 0.6;
        api.activate(); yield 0.3; T.setRule(rc, "ATTRACT", "test"); yield 1;
        check("23 Rewrite reality does not fire when nothing reverses (edit before Play, or a resting pair)", !has("rewrite"), D());

        // persistence: Reset keeps the ticks, Clear all wipes them
        api.clearAll(); yield 0.2; mk23(-7, -6); mk23(7, -6); api.activate(); nodes[0].vel = new vec3(20, 0, 0); yield* waitFor("contact", 3);
        T.toggleCard(); yield 0.5;
        var cs = T.cardState();
        check("23 the card ticks a discovered goal and counts it", has("contact") && cs.header === "Discoveries 1/5" && cs.rows[0].indexOf("\u2713") === 0, cs.header + " | " + cs.rows.join(" / "));
        api.reset(); yield 0.4;
        check("23 progress survives Reset", has("contact") && T.cardState().header === "Discoveries 1/5", D());
        api.clearAll(); yield 0.4;
        check("23 Clear all wipes the progress", D() === "" && T.cardState().header === "Discoveries 0/5", D());
        T.toggleCard(); yield 0.2;

        // the placement hint: only an object really waiting for a pinch shows it; presets, explicit positions and test placement never leave it behind
        api.clearAll(); yield 0.2;
        api.loadDemo(); yield 0.3; var h1 = T.hintVisible() || api.pendingPlacement() >= 0;
        api.loadChain(); yield 0.3; var h2 = T.hintVisible() || api.pendingPlacement() >= 0;
        api.loadUniverse(); yield 0.3; var h3 = T.hintVisible() || api.pendingPlacement() >= 0;
        check("23 presets (demo, chain, universe) never leave the placement hint visible", !h1 && !h2 && !h3, [h1, h2, h3].join());
        api.clearAll(); yield 0.2; api.spawn({ shape: "sphere", sizeKey: "M", pos: new vec3(0, -6, -95) }); yield 0.2;
        check("23 an object spawned at a given position does not wait for a pinch (no hint)", !T.hintVisible() && api.pendingPlacement() === -1);
        var wi = api.spawn({ shape: "sphere", sizeKey: "M" }); yield 0.2; var hw = T.hintVisible();
        T.place(wi, new vec3(10, -6, -95)); yield 0.2;
        check("23 a spawned object shows the hint only until it is placed", hw === true && !T.hintVisible() && api.pendingPlacement() === -1, "waiting " + hw);
        var wj = api.spawn({ shape: "sphere", sizeKey: "M" }); yield 0.2; T.pressStart(wj); yield 0.1; T.pressEnd(wj, true); yield 0.2;
        check("23 pressing the waiting object clears the hint", !T.hintVisible());
        api.clearAll(); yield 0.2;
        api.setDiscoveries(false);

        // 24. Visual pass: curved beams with flowing motes, labels only on the selected link, procedural life on models, light ambient sparkles
        api.clearAll(); yield 0.2;
        T.labelsAll(false);
        api.loadUniverse(); yield 0.8;
        var cn24 = T.connections, bi = cn24.map(function (c) { return T.beamInfo(c); });
        check("24 every connection is a beam of 8 segments with 3 motes", cn24.length === 3 && bi.every(function (b) { return b.segs === 8 && b.motes === 3 && b.root; }), JSON.stringify(bi.map(function (b) { return b.segs + "/" + b.motes; })));
        check("24 beams arc gently (mid-point off the straight line, but not wildly)", bi.every(function (b) { return b.bulge > 0.3 && b.bulge < 10; }), bi.map(function (b) { return b.bulge.toFixed(2); }).join());
        check("24 labels are hidden by default (no selected link)", cn24.every(function (c) { return !c.labelObj.enabled; }));
        T.openEditor(cn24[1]); yield 0.4;
        check("24 only the selected connection shows its rule name", cn24[1].labelObj.enabled && !cn24[0].labelObj.enabled && !cn24[2].labelObj.enabled && cn24[1].label.text === "ATTRACT", cn24.map(function (c) { return c.labelObj.enabled; }).join());
        T.closeEditor(); yield 0.4;
        check("24 the label hides again when the selection closes", cn24.every(function (c) { return !c.labelObj.enabled; }));
        var m0 = T.beamInfo(cn24[0]).moteU; yield 0.5; var m1 = T.beamInfo(cn24[0]).moteU;
        check("24 motes flow along the beam (they move between frames)", m0.some(function (p, i) { return p.distance(m1[i]) > 0.5; }), m0[0].distance(m1[0]).toFixed(2));
        var c24 = cn24[0], mm = [];   // flow direction: the motes advance from the source (A) towards the target (B)
        var dA0 = c24.motes.map(function (m) { return m.tr.getWorldPosition().distance(c24.B.pos); }); yield 0.3;
        var dA1 = c24.motes.map(function (m) { return m.tr.getWorldPosition().distance(c24.B.pos); });
        check("24 motes travel source to target (distance to the target shrinks until they wrap)", dA1.filter(function (d, i) { return d < dA0[i]; }).length >= 2, dA0.map(function (d) { return d.toFixed(1); }).join() + " -> " + dA1.map(function (d) { return d.toFixed(1); }).join());
        check("24 beams take the rule colour", T.linkColor(tcFind(cn24, "COLLISION_TRIGGER")) !== T.linkColor(tcFind(cn24, "ATTRACT")));
        function tcFind(cs, rule) { for (var q = 0; q < cs.length; q++) { if (cs[q].rule === rule) { return cs[q]; } } return cs[0]; }
        // procedural life
        var ids24 = {}; nodes.forEach(function (n, i) { var li = T.lifeInfo(i); if (li && li.kind) { ids24[li.kind] = i; } });
        check("24 all four saved models are recognised (cat, lantern, home, flower)", ids24.cat !== undefined && ids24.lantern !== undefined && ids24.home !== undefined && ids24.flower !== undefined, Object.keys(ids24).join());
        var pos0 = snap(), lanA = [], homeY = [], flS = [];
        for (var f24 = 0; f24 < 24; f24++) { yield 0.1; lanA.push(T.lifeInfo(ids24.lantern).rot.z); homeY.push(T.lifeInfo(ids24.home).pos.y); flS.push(T.lifeInfo(ids24.flower).scale.x); }
        function rng(a) { return Math.max.apply(null, a) - Math.min.apply(null, a); }
        check("24 the lantern sways", rng(lanA) > 0.05, "range " + rng(lanA).toFixed(3));
        check("24 the floating island bobs gently", rng(homeY) > 0.02 && rng(homeY) < 0.2, "range " + rng(homeY).toFixed(3));
        check("24 the flower pulses softly", rng(flS) > 0.02 * flS[0] && rng(flS) < 0.25 * flS[0], "range " + rng(flS).toFixed(4));
        var cl0 = T.lifeInfo(ids24.cat);
        check("24 the idle cat stands still, facing the viewer", Math.abs(cl0.yaw) < 0.05 && cl0.move < 0.05, "yaw " + cl0.yaw.toFixed(2));
        api.activate(); var cMax = 0, cYaw = 0, hopMax = 0, py = T.lifeInfo(ids24.cat).pos.y;
        for (var f25 = 0; f25 < 30; f25++) { yield 0.1; var cl = T.lifeInfo(ids24.cat); cMax = Math.max(cMax, cl.move); if (Math.abs(cl.yaw) > Math.abs(cYaw)) { cYaw = cl.yaw; } hopMax = Math.max(hopMax, cl.pos.y - py); }
        var cvx = nodes[ids24.cat].vel.x;
        check("24 the moving cat turns to face its movement direction and hops", cMax > 0.5 && Math.abs(cYaw) > 0.4 && hopMax > 0.005, "move " + cMax.toFixed(2) + " yaw " + cYaw.toFixed(2) + " hop " + hopMax.toFixed(3));
        check("24 the cat faces the direction it is moving (sign of yaw matches velocity)", Math.abs(cvx) < 0.5 || (cvx > 0) === (T.lifeInfo(ids24.cat).yaw > 0), "vx " + cvx.toFixed(2) + " yaw " + T.lifeInfo(ids24.cat).yaw.toFixed(2));
        check("24 procedural life never moves the physics body (positions come from the sim only)", nodes.every(function (n) { return n.tr.getLocalPosition().distance(n.pos) < 0.01; }));
        api.reset(); yield 0.3;
        var amb = 0; for (var f26 = 0; f26 < 40; f26++) { yield 0.1; amb = Math.max(amb, T.ambientCount()); }
        check("24 ambient sparkles appear near glowing objects and stay within the cap", amb >= 1 && amb <= T.ambientMax, "max " + amb + "/" + T.ambientMax);
        api.clearAll(); yield 0.3; var amb2 = 0; for (var f27 = 0; f27 < 30; f27++) { yield 0.1; amb2 = T.ambientCount(); }
        check("24 with no glowing objects the sparkles fade out", amb2 === 0, "left " + amb2);
        T.labelsAll(true);

        // 25. Room scale: the shipped world (K = ROOM_K), the room preset, the story through the real rule engine, and the legacy presets as scaled copies.
        T.setWorldScale(T.ROOM_K); api.reset(); api.clearAll(); api.loadRoom(); yield 0.5;
        var rb = T.box, rm = api.room, rn = nodes.slice(), rnames = rn.map(function (n) { return n.obj.name; });
        check("25 room preset has the four heroes (home, cat, lantern, flower)", rn.length === 4 && ["Home", "Cat", "Lantern", "Flower"].every(function (s) { return rnames.indexOf(s) >= 0; }), rnames.join());
        check("25 hero objects are 20-40 cm", rn.every(function (n) { return 2 * n.radius >= 19.9 && 2 * n.radius <= 40.1; }), rn.map(function (n) { return (2 * n.radius).toFixed(0); }).join());
        check("25 objects sit 1.1-1.5 m in front of the user", rn.every(function (n) { return -n.pos.z >= 100 && -n.pos.z <= 150; }), rn.map(function (n) { return (-n.pos.z).toFixed(0); }).join());
        var vw = api.view(), tx = vw.halfW / 95, ty = vw.halfH / 95;
        check("25 everything is visible from the default camera, down to the sideboard (angular extents)", rn.every(function (n) { var dp = -n.pos.z; return Math.abs(n.pos.x) + n.radius <= tx * dp + 0.01 && n.pos.y + n.radius <= ty * dp + 0.01 && n.pos.y - n.radius >= -ty * dp - 0.01 && n.pos.y - n.radius >= api.floorY - 0.01; }), "tan x " + tx.toFixed(3) + " tan y " + ty.toFixed(3) + " floor " + api.floorY);
        check("25 all objects are inside the room volume", rn.every(function (n) { return Math.abs(n.pos.x) <= rb.x + 0.01 && n.pos.y >= rb.yMin - 0.01 && n.pos.y <= rb.yMax + 0.01 && n.pos.z <= rb.zNear + 0.01 && n.pos.z >= rb.zFar - 0.01; }));
        var rFloor = rn.filter(function (n) { return n.obj.name === "Cat" || n.obj.name === "Flower"; });
        check("25 the cat and the flower rest on the table (the floor of the play volume)", rFloor.length === 2 && rFloor.every(function (n) { return Math.abs(n.pos.y - n.radius - api.floorY) < 0.6; }), rFloor.map(function (n) { return (n.pos.y - n.radius).toFixed(1); }).join());
        var ys = rn.map(function (n) { return n.pos.y; }).sort(function (a, b) { return a - b; }), hs = 1;
        for (var yi = 1; yi < ys.length; yi++) { if (ys[yi] - ys[yi - 1] > 10) { hs++; } }
        check("25 objects live at different heights (floor, table height, above)", hs >= 3, "bands " + hs);
        check("25 the island house floats above the virtual table plane and the lantern floats elsewhere", rn[0].pos.y - rn[0].radius > api.tableY && rn[2].pos.y - rn[2].radius > api.floorY + 20, "tableY " + api.tableY);
        check("25 links: lantern-flower trigger and cat-lantern attract; no cat-home link at the start", T.connections.length === 2 && conns[0].rule === "COLLISION_TRIGGER" && conns[1].rule === "ATTRACT", T.connections.map(function (c) { return c.rule; }).join());
        var hT = T.planeHit(new vec3(0, 0, 0), new vec3(0, api.tableY, -125).normalize()), hF = T.planeHit(new vec3(0, 0, 0), new vec3(60, api.tableY, -125).normalize()), hU = T.planeHit(new vec3(0, 0, 0), new vec3(0, 20, -100).normalize());
        check("25 surface fallbacks: a ray lands on the virtual table, else the floor, never above the horizon", hT && hT.surface === "table" && Math.abs(hT.p.y - api.tableY) < 0.5 && hF && hF.surface === "floor" && Math.abs(hF.p.y - api.floorY) < 0.5 && hU === null, (hT && hT.surface) + "/" + (hF && hF.surface) + "/" + hU);
        api.activate();
        var catStart = rn[1].pos.distance(rn[2].pos), nearest = catStart;
        for (var f28 = 0; f28 < 80; f28++) { yield 0.1; nearest = Math.min(nearest, rn[1].pos.distance(rn[2].pos)); }
        check("25 story: the cat is drawn toward the lantern", nearest < catStart - 5, "start " + catStart.toFixed(0) + " nearest " + nearest.toFixed(0));
        T.pressStart(2); T.place(2, rn[3].pos.add(new vec3(0, rn[2].radius + rn[3].radius - 0.5, 0))); yield 0.3; T.pressEnd(2, true);   // a real drag: hold the lantern against the flower, then let go
        var flipped = false; for (var f29 = 0; f29 < 60 && !flipped; f29++) { yield 0.1; flipped = conns[1].rule === "REPEL"; }
        check("25 story: dragging the lantern into the flower flips cat-lantern to REPEL (after the pulse)", flipped, "rule " + conns[1].rule);
        var d0 = rn[1].pos.distance(rn[2].pos); yield 3;
        var d1 = rn[1].pos.distance(rn[2].pos);
        check("25 story: the cat flees from the lantern", d1 > d0 + 5, d0.toFixed(0) + " -> " + d1.toFixed(0));
        check("25 room physics stays inside the volume and never overlaps", violations.bounds === 0 && violations.overlap === 0, "bounds " + violations.bounds + " overlap " + violations.overlap);
        T.openEditor(conns[1]); yield 0.3; var dR0 = rn[1].pos.distance(rn[2].pos), okA = api.applyEditorRule("ATTRACT"); yield 4; var dR1 = rn[1].pos.distance(rn[2].pos);
        check("25 story: switching cat-lantern back to Attract brings the cat clearly back toward the lantern", okA && conns[1].rule === "ATTRACT" && dR1 < dR0 - 8, dR0.toFixed(0) + " -> " + dR1.toFixed(0));

        // 26. Presentation: the selected link's label beside its own beam, separated arcs, the Create menu in empty space, the armed Connect state
        api.reset(); yield 0.3; T.labelsAll(false);
        var c26 = conns[1]; T.labelsAll(true); T.openEditor(c26); yield 0.5;
        check("26 the selected link's label sits at its own beam midpoint (beside it, in view, never far)", T.labelToMid(c26) >= 0 && T.labelToMid(c26) < 16 && T.labelFits(c26), "gap " + T.labelToMid(c26).toFixed(1));
        T.closeEditor(); T.labelsAll(false);
        var ex26 = api.spawn({ shape: "sphere", sizeKey: "M", bounce: "low", weight: "light" }); T.place(ex26, new vec3(6, -4, -125)); var cx26 = T.connect(1, ex26, "ATTRACT"); yield 1.5;
        check("26 two beams leaving the cat in similar directions arc taller, to opposite sides (or routed clear of an object instead)", (c26.arcAmt * cx26.arcAmt < 0 || T.beamClipNow(cx26) < 0.0008) && Math.abs(c26.arcAmt) > 1.5 && Math.abs(cx26.arcAmt) > 1.5, c26.arcAmt.toFixed(2) + " / " + cx26.arcAmt.toFixed(2));
        check("26 the two arcs are clearly separate (control points more than 10 cm apart)", c26.arcC.distance(cx26.arcC) > 10, c26.arcC.distance(cx26.arcC).toFixed(1));
        T.labelsAll(true); T.openEditor(cx26); yield 0.5;
        check("26 even in a crowded spot the label stays near its own beam midpoint and in view", T.labelToMid(cx26) < 22 && T.labelFits(cx26), "gap " + T.labelToMid(cx26).toFixed(1));
        T.closeEditor(); T.labelsAll(false); T.deleteNode(ex26); yield 0.3;
        T.openMenu("create"); yield 0.3; var cp26 = T.createPlacement(), lim26 = api.view().halfW / 95;
        check("26 the Create menu opens in empty space: it covers no object and stays inside the view", cp26 && cp26.penetration < 0.001 && Math.abs(cp26.rect.x) + cp26.rect.hw <= lim26 + 0.001, cp26 ? "pen " + cp26.penetration.toFixed(4) : "none");
        T.closeMenus(); yield 0.2;
        T.tap(1); yield 0.2; api.connectSelected(); yield 0.5;
        check("26 Connect armed: bright fill, a hint beside the pill, the object highlighted", api.connectArmed() && T.connectColor()[1] > 0.8 && T.connectHintVisible() && T.armHaloOn(), JSON.stringify(T.connectColor()) + " hint " + T.connectHintVisible() + " halo " + T.armHaloOn());
        T.tap(1); yield 0.5;
        check("26 cancelling the selection disarms Connect and clears the hint and highlight", !api.connectArmed() && !T.connectHintVisible() && !T.armHaloOn(), "armed " + api.connectArmed());
        T.tap(1); yield 0.3;
        check("26 selecting an object again does not start armed", !api.connectArmed() && T.selected() === 1);
        T.tap(1); yield 0.2;
        // 27. Final presentation: the world stands on the real sideboard, the toolbar clears it, no floating label with the panel open, panel beside its link, beams routed around objects
        api.reset(); yield 0.3; api.clearAll(); api.loadRoom(); yield 0.8;
        var vw27 = api.view(), n27 = nodes.slice(), cat27 = 1, lan27 = 2, flo27 = 3, hom27 = 0;
        check("27 the floor of the room is the sideboard top (the thin strip at the bottom of the default view)", api.floorY / 125 < -0.277 && api.floorY / 125 > -vw27.halfH / 95, "angular " + (api.floorY / 125).toFixed(3));
        check("27 the cat and the flower visibly stand on the surface (model feet within 1 cm of it)", [cat27, flo27].every(function (i) { var b = T.visualBottom(i); return b !== null && Math.abs(b - api.floorY) < 1.0; }), [cat27, flo27].map(function (i) { return (T.visualBottom(i) - api.floorY).toFixed(2); }).join());
        check("27 the lantern floats above the sideboard and the island house floats higher, on the left", n27[lan27].pos.y - n27[lan27].radius > api.floorY + 15 && n27[hom27].pos.y > n27[lan27].pos.y && n27[hom27].pos.x < 0, "lantern y " + n27[lan27].pos.y.toFixed(0) + " house y " + n27[hom27].pos.y.toFixed(0));
        var tfin = ctl.toolbarFit(), tbLeft = (tfin.centers[0] - tfin.pillWidth / 2) / 95 * 125;
        check("27 the toolbar sits low in the right corner, clear of the cat and the flower", tbLeft > n27[flo27].pos.x + 6 && tbLeft > n27[cat27].pos.x + 20, "toolbar left at 1.25 m: " + tbLeft.toFixed(1) + " cm, flower x " + n27[flo27].pos.x.toFixed(1));
        check("27 the toolbar keeps three pills, each at least 4.5 cm wide", tfin.labels.length === 3 && tfin.pillWidth >= 4.5, "pill " + tfin.pillWidth);
        var c27 = conns[1]; T.openEditor(c27); yield 0.6;
        check("27 with the rule panel open the link shows no floating label (the panel names the rule)", T.beamInfo(c27).labelOn === false, "labelOn " + T.beamInfo(c27).labelOn);
        var ei27 = api.editorInfo(), mid27 = c27.A.pos.add(c27.B.pos).uniformScale(0.5), md27 = Math.max(-mid27.z, 1);
        check("27 the rule panel (one narrow column) opens near the selected link's midpoint, on its free side", ei27 && Math.sqrt((ei27.x - mid27.x / md27) * (ei27.x - mid27.x / md27) + (ei27.y - mid27.y / md27) * (ei27.y - mid27.y / md27)) < 0.32, ei27 ? "dx " + (ei27.x - mid27.x / md27).toFixed(3) + " dy " + (ei27.y - mid27.y / md27).toFixed(3) : "none");
        check("27 the panel covers no object and stays above the sideboard line", T.editorOverlaps() === 0 && ei27 && ei27.y > api.toolbarTop(), "overlaps " + T.editorOverlaps());
        T.closeEditor(); yield 0.2;
        T.editorFitReset(); var okFit27 = true, wFit27 = [];
        for (var ri = 0; ri < 5; ri++) { var rr = ["ATTRACT", "REPEL", "COLLISION_TRIGGER", "TRANSFER", "GROW"][ri]; T.openEditor(c27); yield 0.3; api.applyEditorRule(rr); yield 0.2; }
        T.openEditor(c27); yield 0.3; var ef27 = T.editorFit(); T.closeEditor();
        check("27 every rule name, with its check mark, fits inside its pill (Transfer and Collision Trigger included)", ef27.widths.length === 5 && ef27.widths.every(function (w) { return w > 0 && w <= ef27.pill - 0.8; }), ef27.widths.map(function (w) { return w.toFixed(2); }).join() + " of " + ef27.pill);
        api.reset(); yield 0.3;
        var mid28 = n27[cat27].pos.add(n27[lan27].pos).uniformScale(0.5), blk27 = api.spawn({ shape: "sphere", sizeKey: "S", bounce: "low", weight: "light" }); T.place(blk27, new vec3(mid28.x + 2, mid28.y + 2, mid28.z)); yield 1.5;
        check("27 a beam that would pass through another object bends around it (no overlap with any object)", T.beamClipNow(conns[1]) < 0.0008 && conns.every(function (c) { return T.beamClipNow(c) < 0.0008; }), conns.map(function (c) { return T.beamClipNow(c).toFixed(4); }).join());
        T.deleteNode(blk27); yield 0.3;
        api.reset(); yield 0.3;
        // 28. Real-object nodes: pinch a real object, pick its name from a short list, and it becomes an immovable anchored node that links and obeys all five rules
        api.reset(); yield 0.3; api.clearAll(); api.loadRoom(); yield 0.8;
        api.clearLinks(); var cat28 = 1, lan28 = 2, flo28 = 3, n0_28 = nodes.length;
        T.place(cat28, new vec3(22, nodes[cat28].pos.y, nodes[cat28].pos.z)); T.place(flo28, new vec3(0, 18, nodes[flo28].pos.z)); yield 0.5;
        var TURN28 = new vec3(-0.221, -0.2975, -1); TURN28 = TURN28.uniformScale(1 / TURN28.length);   // the ray through the real turntable in the Sunlit Room
        T.realPinchRay(new vec3(0, 0, 0), TURN28); yield 0.5;
        var mi28 = api.realMenuInfo(), ui28 = T.realMenuInfo(), lim28 = api.view().halfW / 95;
        check("28 a pinch on empty space opens the name list: the six names and Cancel", !!mi28 && ui28.shown && ui28.names.join(",") === "Lamp,Table,Plant,Speaker,Turntable,Chair,Cancel", ui28 ? ui28.names.join(",") : "none");
        check("28 the list sits beside the pinch, inside the view, without covering the pinched point", ui28.rect && Math.abs(ui28.rect.x) + ui28.rect.hw <= lim28 + 0.001 && !(Math.abs(mi28.x - ui28.rect.x) < ui28.rect.hw && Math.abs(mi28.y - ui28.rect.y) < ui28.rect.hh), JSON.stringify(ui28.rect));
        var t28 = nodes.length; var tn28 = api.chooseReal("Turntable"); yield 0.5;
        var ti28 = nodes.indexOf(nodes.filter(function (n) { return n.real; })[0]), ri28 = T.realInfo(ti28);
        check("28 choosing Turntable adds one anchored node with no model, three glow rings and a name tag", nodes.length === t28 + 1 && ri28 && ri28.anchored && !ri28.modelVisible && ri28.rings === 3 && ri28.tag === "Turntable", JSON.stringify(ri28 && { a: ri28.anchored, m: ri28.modelVisible, r: ri28.rings, t: ri28.tag }));
        check("28 the node is on the pinched point (ray onto the room's depth plane) and the list has closed", nodes[ti28].pos.distance(new vec3(-27.6, -37.2, -125)) < 0.6 && api.realMenuInfo() === null, nodes[ti28].pos.x.toFixed(1) + "," + nodes[ti28].pos.y.toFixed(1) + "," + nodes[ti28].pos.z.toFixed(0));
        check("28 the Turntable's collision size is its default (15 cm across) and the tag sits above the ring", Math.abs(ri28.radius - 7.5) < 0.01 && ri28.tagY > nodes[ti28].pos.y + ri28.radius, "r " + ri28.radius + " tagY " + ri28.tagY.toFixed(1));
        // every type has its own default size, and Cancel creates nothing
        var sizes28 = { Lamp: 16, Table: 40, Plant: 16, Speaker: 10, Turntable: 15, Chair: 30 }, okSz28 = true, bad28 = "";
        for (var nm28 in sizes28) {
            T.realPinchRay(new vec3(0, 0, 0), new vec3(0.1, 0.0, -1).uniformScale(1 / new vec3(0.1, 0, -1).length)); yield 0.1;
            var k28 = api.chooseReal(nm28); yield 0.2; var tk28 = nodes.length - 1, ik28 = T.realInfo(tk28);
            if (!ik28 || Math.abs(ik28.radius * 2 - sizes28[nm28]) > 0.01 || ik28.tag !== nm28) { okSz28 = false; bad28 += nm28 + " "; }
            T.deleteNode(tk28); yield 0.2;
        }
        check("28 every type creates a node with its default size and its own name tag", okSz28, bad28);
        var before28 = nodes.length; T.realPinchRay(new vec3(0, 0, 0), new vec3(0.2, 0.1, -1).uniformScale(1 / new vec3(0.2, 0.1, -1).length)); yield 0.1; var cn28 = api.chooseReal(null); yield 0.2;
        check("28 Cancel creates nothing and closes the list", nodes.length === before28 && api.realMenuInfo() === null && cn28 === null);
        var sp28 = T.realPinchScreen(new vec2(0.5, 0.06)); yield 0.2; var open28 = api.realMenuInfo() !== null;
        var sp28b = T.realPinchScreen(new vec2(0.5, 0.06)); yield 0.2;
        check("28 a press on empty screen opens the list and a second press elsewhere closes it again", sp28 === "menu" && open28 && sp28b !== null && api.realMenuInfo() === null, sp28 + "/" + sp28b);
        // link and rules
        var init28 = new vec3(nodes[ti28].pos.x, nodes[ti28].pos.y, nodes[ti28].pos.z);
        var c28 = T.connect(cat28, ti28, "ATTRACT"); api.toggle(); yield 14;
        var rest28 = nodes[cat28].radius + nodes[ti28].radius, d28 = nodes[cat28].pos.distance(nodes[ti28].pos);
        check("28 story: cat-turntable Attract: the cat walks to the real turntable and settles touching it", nodes[cat28].pos.x < 0 && d28 < rest28 + 2 && d28 > rest28 - 2, "dist " + d28.toFixed(1) + " rest " + rest28.toFixed(1) + " cat x " + nodes[cat28].pos.x.toFixed(1));
        check("28 the turntable has not moved (position and transform)", nodes[ti28].pos.distance(init28) < 1e-6 && nodes[ti28].tr.getLocalPosition().distance(init28) < 1e-6);
        T.openEditor(c28); yield 0.3; var ed28 = api.editorInfo();
        check("28 the rule panel opens for the real link", !!ed28 && ed28.rule === "ATTRACT");
        api.applyEditorRule("REPEL"); yield 5;
        var dr28 = nodes[cat28].pos.distance(nodes[ti28].pos);
        check("28 Repel: the cat is pushed away from the real object, which stays put", c28.rule === "REPEL" && dr28 > d28 + 10 && nodes[ti28].pos.distance(init28) < 1e-6, d28.toFixed(1) + " -> " + dr28.toFixed(1));
        T.closeEditor();
        api.toggle(); api.reset(); yield 0.3;
        check("28 Reset keeps the real object (and its link) where it is", nodes.length === n0_28 + 1 && nodes[ti28].real && nodes[ti28].pos.distance(init28) < 1e-6 && c28.active);
        // Collision Trigger, Transfer and Grow
        var fl28 = c28.fires || 0; c28.rule = "COLLISION_TRIGGER"; T.place(cat28, init28.add(new vec3(rest28 * 0.8, 10.7, 0))); api.toggle(); yield 1.5;
        check("28 Collision Trigger: the cat touching the real object fires the link", (c28.fires || 0) > fl28, "fires " + (c28.fires || 0));
        api.toggle(); api.reset(); yield 0.3;
        c28.rule = "TRANSFER"; T.place(cat28, init28.add(new vec3(30, 10.7, 0))); api.toggle(); nodes[cat28].vel = new vec3(-40, 0, 0); var v0_28 = nodes[cat28].vel.length; yield 0.3;
        var vmax28 = 0; for (var q28 = 0; q28 < 25; q28++) { vmax28 = Math.max(vmax28, nodes[cat28].vel.length); yield 0.1; }
        check("28 Transfer: the real object takes the whole hit, the cat gives up its speed, the object stays put", nodes[cat28].vel.length < v0_28 * 0.35 && nodes[ti28].pos.distance(init28) < 1e-6, "v " + v0_28.toFixed(1) + " -> " + nodes[cat28].vel.length.toFixed(1));
        api.toggle(); api.reset(); yield 0.3;
        c28.rule = "GROW"; var r28 = nodes[ti28].radius; T.place(cat28, init28.add(new vec3(rest28 * 0.8, 10.7, 0))); api.toggle(); yield 1.5;
        check("28 Grow: touching makes the real object's ring (and collision size) grow, still anchored", nodes[ti28].radius > r28 * 1.1 && nodes[ti28].pos.distance(init28) < 1e-6, r28.toFixed(1) + " -> " + nodes[ti28].radius.toFixed(1));
        api.toggle(); api.reset(); yield 0.3;
        check("28 Reset also restores the ring size", Math.abs(nodes[ti28].radius - r28) < 0.01);
        // dragging cannot move it; Connect / Remove work on it like on any node
        T.pressStart(ti28); nodes[ti28].tr.setLocalPosition(new vec3(0, 0, -125)); yield 0.3; T.pressEnd(ti28, false); yield 0.3;
        check("28 dragging does not move it: it snaps back", nodes[ti28].pos.distance(init28) < 1e-6 && nodes[ti28].tr.getLocalPosition().distance(init28) < 1e-6);
        c28.rule = "ATTRACT"; T.tap(ti28); yield 0.2; var si28 = api.selectedInfo();
        check("28 tapping it selects it (Connect and Remove appear beside the ring)", !!si28 && Math.abs(si28.r - nodes[ti28].radius) < 0.01 && T.selected() === ti28);
        api.connectSelected(); yield 0.2; T.tap(lan28); yield 0.3; var cl28 = T.connections.filter(function (c) { return c.active && ((c.A === nodes[ti28] && c.B === nodes[lan28]) || (c.B === nodes[ti28] && c.A === nodes[lan28])); });
        check("28 Connect links it to another object (turntable-lantern)", cl28.length === 1);
        T.tap(ti28); yield 0.2; var cnt28 = nodes.length, act28 = T.connections.filter(function (c) { return c.active; }).length; api.deleteSelected(); yield 0.3;
        check("28 Remove deletes the real object, its links and its tag", nodes.length === cnt28 - 1 && T.connections.filter(function (c) { return c.active; }).length === act28 - 2 && nodes.every(function (n) { return !n.real; }), nodes.length + " nodes");
        T.realPinchRay(new vec3(0, 0, 0), TURN28); yield 0.1; api.chooseReal("Speaker"); yield 0.3;
        var hadReal28 = nodes.some(function (n) { return n.real; }); api.clearAll(); yield 0.3;
        check("28 Clear removes real objects too", hadReal28 && nodes.length === 0 && api.realMenuInfo() === null);
        yield 0.3;
        T.setWorldScale(1); api.clearAll();

        api.reset();
        var pass =results.filter(function (r) { return r; }).length;
        print("RULESHIFT TEST SUMMARY: " + pass + "/" + results.length + " PASS" + (pass === results.length ? " - ALL PASS" : " - FAILURES"));
    }
    script.createEvent("OnStartEvent").bind(function () {
        api = script.controller.api; T = api.test; nodes = T.nodes; conns = T.connections;
        T.setFixedStep(SIM_STEP);
        T.labelsAll(true);   // sections 0-23 measure every label; section 24 covers the shipped default (only the selected link shows its name)
        gen = run();
    });
    script.createEvent("UpdateEvent").bind(function (e) {
        if (!gen) { return; }
        if (monitorOn) { mon(); }
        wait -= (T.fixedStep() > 0 ? T.fixedStep() : e.getDeltaTime());   // the suite runs on the controller's fixed simulation clock (see SIM_STEP): waits count simulated seconds, not wall time
        if (wait > 0) { return; }
        var r = gen.next();
        if (r.done) { gen = null; } else { wait = r.value; }
    });
}

// Model regeneration harness (needs a local token): refine:true generations for the four hero models, printing each download URL.
// Reads: RULESHIFT GEN <name> try <k> OK secs=... url=<glb url>   (or FAIL ... reason)
if (script.genModels) {   // input declared in the header block
    script.createEvent("OnStartEvent").bind(function () {
        var api = script.controller.api, el = 0, st = 0, pending = 0, round = 0;
        var PROMPTS = { house: "a cozy library house on a floating island", cat: "a cute cat", lantern: "a glowing paper lantern", flower: "a glowing flower" };
        script.createEvent("UpdateEvent").bind(function (e) {
            el += e.getDeltaTime();
            if (st === 0 && el > 3) {
                st = 1;
                (function startRound() {
                    round++; if (round > 2) { st = 2; return; }
                    Object.keys(PROMPTS).forEach(function (name) {
                        pending++;
                        var t0 = getTime();
                        api.generate(PROMPTS[name], { refine: true }, {
                            onSuccess: function (g, url) { print("RULESHIFT GEN " + name + " try " + round + " OK secs=" + (getTime() - t0).toFixed(0) + " url=" + url); if (--pending === 0) { startRound(); } },
                            onFail: function (why) { print("RULESHIFT GEN " + name + " try " + round + " FAIL " + why); if (--pending === 0) { startRound(); } }
                        });
                    });
                })();
            }
        });
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

// Visual check (not a test): load the universe stage, wait for a screenshot, press Play, print a marker once the collision fires and the chain has flipped.
if (script.showUniverse) {
    script.createEvent("OnStartEvent").bind(function () {
        var api = script.controller.api, T = api.test, st = 0, el = 0;
        script.createEvent("UpdateEvent").bind(function (e) {
            el += e.getDeltaTime();
            if (st === 0 && el > 1) { script.controller.demoStage = "universe"; api.applyDemoSetup(); st = 1; print("RULESHIFT SHOW opening"); }
            else if (st === 1 && el > 11) { api.activate(); st = 2; T.toggleCard(); print("RULESHIFT SHOW play (Discoveries card open)"); }
            else if (st === 2 && T.connections.some(function (c) { return c.rule === "REPEL"; }) && el > 11.8) { st = 3; print("RULESHIFT SHOW chain-flipped"); }
        });
    });
}

// Visual check (not a test): load the room preset, wait for a screenshot, press Play, print a marker mid-chase, then drag the lantern into the flower and print a marker once the chain has flipped.
if (script.showRoom) {
    script.createEvent("OnStartEvent").bind(function () {
        var api = script.controller.api, T = api.test, st = 0, el = 0, fN = 0, fT = 0, stEl = 0, abSi = -1, abN = [0, 0], abT = [0, 0], abState = -1; T.prof(true);
        script.createEvent("UpdateEvent").bind(function (e) {
            var d = e.getDeltaTime(); el += d; fN++; fT += d;
            if (fT >= 5) { print("RULESHIFT ROOM fps " + (fN / fT).toFixed(1) + " | " + T.profReport()); fN = 0; fT = 0; }
            if (st === 0 && el > 1) {
                script.controller.demoStage = "room"; api.applyDemoSetup(); st = 1; print("RULESHIFT SHOW room-opening");
                var v = api.view(); print("RULESHIFT ROOM view halfW=" + v.halfW.toFixed(1) + " halfH=" + v.halfH.toFixed(1) + " at 95 cm (tan x " + (v.halfW / 95).toFixed(3) + ", tan y " + (v.halfH / 95).toFixed(3) + ")");
                T.nodes.forEach(function (n) { var dp = -n.pos.z; print("RULESHIFT ROOM node " + n.obj.name + " pos " + n.pos.x.toFixed(0) + "," + n.pos.y.toFixed(0) + "," + n.pos.z.toFixed(0) + " r=" + n.radius.toFixed(0) + " ang " + (n.pos.x / dp).toFixed(3) + "," + (n.pos.y / dp).toFixed(3) + " angR " + (n.radius / dp).toFixed(3)); });
            }
            else if (script.perfSweep && st === 1 && el > 30) {   // frame-cost attribution, interleaved A/B: each subsystem is switched on/off every 5 s for 4 cycles (drift cancels); fps is averaged over the last 3.5 s of each phase
                var rootSet = function (nm, child, on) { for (var q = 0; q < global.scene.getRootObjectsCount(); q++) { var ro = global.scene.getRootObject(q); if (ro.name === nm) { if (child) { for (var w = 0; w < ro.getChildrenCount(); w++) { if (ro.getChild(w).name === child) { ro.getChild(w).enabled = on; } } } else { ro.enabled = on; } } } };
                var subs = [["ALL content (vfx, beams, halos, models, ambient, SIK visuals, UI)", function (on) { T.perfSet("vfx", on); T.perfSet("beams", on); T.perfSet("glow", on); T.perfSet("models", on); T.perfSet("ambient", on); rootSet("SpectaclesInteractionKit", "[OPTIONAL] Visuals", on); rootSet("RULESHIFT Controls", null, on); }], ["UI (RULESHIFT Controls)", function (on) { rootSet("RULESHIFT Controls", null, on); }], ["lighting", function (on) { rootSet("Lighting", null, on); }], ["ambient sparkles", function (on) { T.perfSet("ambient", on); }], ["end", function () { }]];
                var t = el - 30, si = Math.floor(t / 40); if (si === subs.length - 1 && abSi >= 0 && abSi !== si) { print("RULESHIFT AB " + subs[abSi][0] + " on " + (abN[0] / Math.max(abT[0], 0.001)).toFixed(2) + " fps, off " + (abN[1] / Math.max(abT[1], 0.001)).toFixed(2) + " fps"); abSi = si; st = 9; subs.forEach(function (x) { x[1](true); }); print("RULESHIFT AB done"); }
                if (si >= subs.length) { if (st !== 9) { st = 9; subs.forEach(function (x) { x[1](true); }); print("RULESHIFT AB done"); } }
                else {
                    var ph2 = Math.floor((t % 40) / 5), isOff = ph2 % 2 === 1, within = (t % 40) % 5;
                    if (si !== abSi) {
                        if (abSi >= 0) { print("RULESHIFT AB " + subs[abSi][0] + " on " + (abN[0] / Math.max(abT[0], 0.001)).toFixed(2) + " fps, off " + (abN[1] / Math.max(abT[1], 0.001)).toFixed(2) + " fps"); }
                        abSi = si; abN = [0, 0]; abT = [0, 0]; abState = -1;
                    }
                    if (abState !== (isOff ? 1 : 0)) { abState = isOff ? 1 : 0; subs[si][1](!isOff); }
                    if (within > 1.5) { abN[abState]++; abT[abState] += d; }
                }
            }
            else if (!script.perfSweep && st === 1 && el > 6) { st = 2; print("RULESHIFT SHOW room-before"); }
            else if (script.roomPlay && st === 2 && el > 24) { api.activate(); st = 3; stEl = el; print("RULESHIFT SHOW room-play"); }
            else if (st === 3 && el > stEl + 2.5) { st = 4; stEl = el; T.setFixedStep(0.0001); print("RULESHIFT SHOW room-chase (frozen)"); }   // freeze the sim so a screenshot taken a few seconds later shows this exact frame
            else if (st === 4 && el > stEl + 15) { T.setFixedStep(0); var n = T.nodes; T.place(2, n[3].pos.add(new vec3(0, n[2].radius + n[3].radius - 0.5, 0))); st = 5; stEl = el; print("RULESHIFT SHOW room-collide"); }
            else if (st === 5 && T.connections.some(function (c) { return c.rule === "REPEL"; })) { st = 6; stEl = el; print("RULESHIFT SHOW room-flipped"); }
            else if (st === 6 && el > stEl + 9) { st = 7; T.setFixedStep(0.0001); print("RULESHIFT SHOW room-fled (frozen)"); }
        });
    });
}





// Visual check (not a test): the UI-stage screenshots in the room preset from the default camera. Markers: ui-nothing, ui-create, ui-object, ui-connection (each held ~14 s, the sim stays in Building).
if (script.showUi) {
    script.createEvent("OnStartEvent").bind(function () {
        var api = script.controller.api, T = api.test, st = 0, el = 0, t0 = 0;
        script.createEvent("UpdateEvent").bind(function (e) {
            el += e.getDeltaTime();
            if (st === 0 && el > 1) { script.controller.demoStage = "room"; api.applyDemoSetup(); st = 1; t0 = el; }
            else if (st === 1 && el > t0 + 8) { st = 2; t0 = el; print("RULESHIFT SHOWUI ui-nothing"); }
            else if (st === 2 && el > t0 + 24) { T.openMenu("create"); st = 3; t0 = el; print("RULESHIFT SHOWUI ui-create"); }
            else if (st === 3 && el > t0 + 24) { T.closeMenus(); T.tap(1); st = 4; t0 = el; print("RULESHIFT SHOWUI ui-object"); }
            else if (st === 4 && el > t0 + 24) { T.tap(1); T.openEditor(T.connections[1]); st = 5; t0 = el; print("RULESHIFT SHOWUI ui-connection"); }
            else if (st === 5 && el > t0 + 24) { st = 6; print("RULESHIFT SHOWUI done"); }
        });
    });
}

// Visual check (not a test): demo scene running live with the rule editor open on the first link; prints a marker for the screenshot.
if (script.showEditor) {
    script.createEvent("OnStartEvent").bind(function () {
        var api = script.controller.api, T = api.test, st = 0, el = 0;
        script.createEvent("UpdateEvent").bind(function (e) {
            el += e.getDeltaTime();
            if (st === 0 && el > 1) { api.loadDemo(); st = 1; }
            else if (st === 1 && el > 2) { api.activate(); st = 2; }
            else if (st === 2 && el > 4) { T.openEditor(T.connections[0]); st = 3; }
            else if (st === 3 && el > 6) { print("RULESHIFT SHOWEDITOR open state=" + api.getState() + " overlaps=" + T.editorOverlaps()); st = 4; }
        });
    });
}

// Visual check (not a test): Grow -> Collision Trigger -> Attract chain with the cause pulse stretched to 6 s; marker printed mid-flight.
if (script.showGrow) {
    script.createEvent("OnStartEvent").bind(function () {
        var api = script.controller.api, T = api.test, st = 0, el = 0;
        function mk(x, y, col) { var i = api.spawn({ shape: "sphere", sizeKey: "M", color: col, bounce: "low", weight: "light" }); T.place(i, new vec3(x, y, -95)); T.nodes[i].initial = new vec3(x, y, -95); return i; }
        script.createEvent("UpdateEvent").bind(function (e) {
            el += e.getDeltaTime();
            if (st === 0 && el > 1) {
                api.clearAll(); T.cause.setTime(6);
                mk(-5, -8, [1, 0, 0.35]); mk(5, -8, [0, 0.85, 1]); mk(15.4, -8, [1, 0.9, 0]); mk(10, 5, [0.65, 0.3, 1]);
                T.connect(0, 1, "GROW"); T.connect(1, 2, "COLLISION_TRIGGER"); T.connect(2, 3, "ATTRACT");
                st = 1;
            } else if (st === 1 && el > 3) { api.activate(); st = 2; }
            else if (st === 2 && el > 5) { print("RULESHIFT SHOWGROW mid-chain grow=" + T.nodes[1].growK.toFixed(2) + " ct fires=" + T.fires(T.connections[1]) + " pulses=" + T.cause.active() + " link2=" + T.connections[2].rule); st = 3; }
        });
    });
}

// Screenshot tour (not a test): runs the scenes for the Devpost screenshots in order, printing "RULESHIFT SHOT <n> <name>" when each is ready; the capture is taken from outside.
if (script.showShots) {
    script.createEvent("OnStartEvent").bind(function () {
        var api = script.controller.api, T = api.test, z = -95, step = 0, since = 0, sub = 0;
        function mk(x, y, col) { var i = api.spawn({ shape: "sphere", sizeKey: "M", color: col, bounce: "low", weight: "light" }); T.place(i, new vec3(x, y, z)); T.nodes[i].initial = new vec3(x, y, z); return i; }
        function shot(n, name) { print("RULESHIFT SHOT " + n + " " + name); }
        function link(a, b) { return T.connections.filter(function (c) { return c.active && ((c.A.obj.name === a && c.B.obj.name === b) || (c.A.obj.name === b && c.B.obj.name === a)); })[0]; }
        var steps = [
            [2, function () { api.clearAll(); shot(1, "empty-stage"); }],
            [14, function () { T.togglePalette(true); shot(2, "palette-open"); }],
            [14, function () { T.togglePalette(false); api.clearAll(); api.setGenerator(function () { }); api.imagine("a floating paper lantern"); shot(3, "imagining"); }],
            [14, function () { api.setGenerator(null); api.clearAll(); script.controller.demoStage = "universe"; api.applyDemoSetup(); shot(4, "universe-before"); }],
            [14, function () { api.activate(); }],
            [9, function () { shot(5, "universe-chase"); }],
            [14, function () { T.cause.setTime(6); T.pressStart(2); sub = 0; }],
            [0.35, function () {   // glide the lantern up the right edge into the flower
                var ys = [-10, -5, -1, 2, 4], n = T.nodes[2];
                if (sub < ys.length) { n.tr.setLocalPosition(new vec3(17, ys[sub], z)); sub++; step--; return; }
                T.pressEnd(2, true);
            }],
            [3.5, function () { shot(6, "universe-chain"); }],
            [30, function () { T.cause.setTime(0.5); }],
            [2, function () { shot(7, "universe-after"); }],
            [14, function () { api.reset(); api.clearAll(); api.loadDemo(); }],
            [2, function () { api.activate(); }],
            [3, function () { T.openEditor(T.connections[0]); }],
            [3, function () { shot(8, "rule-editor"); }],
            [14, function () { T.closeEditor(); api.clearAll(); T.cause.setTime(6); mk(-5, -8, [1, 0, 0.35]); mk(5, -8, [0, 0.85, 1]); mk(15.4, -8, [1, 0.9, 0]); mk(10, 5, [0.65, 0.3, 1]); T.connect(0, 1, "GROW"); T.connect(1, 2, "COLLISION_TRIGGER"); T.connect(2, 3, "ATTRACT"); }],
            [2, function () { api.activate(); }],
            [2, function () { shot(9, "grow-chain"); }],
            [14, function () { T.cause.setTime(0.5); api.clearAll(); mk(-7, -6, [1, 0, 0.35]); mk(7, -6, [0, 0.85, 1]); api.activate(); T.nodes[0].vel = new vec3(20, 0, 0); }],
            [2, function () { T.toggleCard(); }],
            [3, function () { shot(10, "discoveries"); }],
            [14, function () { api.clearAll(); T.toggleCard(); print("RULESHIFT SHOT done"); }]
        ];
        var waitPulse = null;   // retake mode: print the shot as soon as a cause pulse is travelling
        if (script.shotsPulses) {
            steps = [
                [2, function () { api.clearAll(); script.controller.demoStage = "universe"; api.applyDemoSetup(); }],
                [2, function () { api.activate(); }],
                [22, function () { T.cause.setTime(12); T.pressStart(2); sub = 0; }],
                [0.35, function () {
                    var ys = [-10, -5, -1, 2, 4], n = T.nodes[2];
                    if (sub < ys.length) { n.tr.setLocalPosition(new vec3(17, ys[sub], z)); sub++; step--; return; }
                    T.pressEnd(2, true); waitPulse = [6, "universe-chain"];
                }],
                [40, function () { T.cause.setTime(0.5); api.clearAll(); }],
                [2, function () { T.cause.setTime(12); mk(-5, -8, [1, 0, 0.35]); mk(5, -8, [0, 0.85, 1]); mk(15.4, -8, [1, 0.9, 0]); mk(10, 5, [0.65, 0.3, 1]); T.connect(0, 1, "GROW"); T.connect(1, 2, "COLLISION_TRIGGER"); T.connect(2, 3, "ATTRACT"); }],
                [2, function () { api.activate(); waitPulse = [9, "grow-chain"]; }],
                [40, function () { T.cause.setTime(0.5); api.clearAll(); print("RULESHIFT SHOT done"); }]
            ];
        }
        script.createEvent("UpdateEvent").bind(function (e) {
            if (waitPulse && T.cause.active() > 0) { shot(waitPulse[0], waitPulse[1]); waitPulse = null; }
            since += e.getDeltaTime();
            if (step >= steps.length) { return; }
            if (since >= steps[step][0]) { var f = steps[step][1]; since = 0; step++; f(); }
        });
    });
}
