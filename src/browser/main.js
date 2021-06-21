"use strict";

var index_path = -1;

(function() {
    /** @const */
    var ON_LOCALHOST = !location.hostname.endsWith("copy.sh");

    /** @const */
    var HOST = ON_LOCALHOST ? "images/" : "//k.copy.sh/";

    /**
     * @return {Object.<string, string>}
     */
    function get_query_arguments() {
        var query = location.search.substr(1).split("&");
        var parameters = {};

        for (var i = 0; i < query.length; i++) {
            var param = query[i].split("=");
            parameters[param[0]] = decodeURIComponent(param.slice(1).join("="));
        }

        return parameters;
    }

    function chr_repeat(chr, count) {
        var result = "";

        while (count-- > 0) {
            result += chr;
        }

        return result;
    }

    var progress_ticks = 0;

    function show_progress(e) {
        var el = $("loading");
        el.style.display = "block";

        if (e.file_name.endsWith(".wasm")) {
            const parts = e.file_name.split("/");
            el.textContent = "Loading " + parts[parts.length - 1] + " ...";
            return;
        }

        if (e.file_index === e.file_count - 1 && e.loaded >= e.total - 2048) {
            // last file is (almost) loaded
            el.textContent = "Done loading. Starting now ...";
            return;
        }

        var line = "Loading images ";

        if (typeof e.file_index === "number" && e.file_count) {
            line += "[" + (e.file_index + 1) + "/" + e.file_count + "] ";
        }

        if (e.total && typeof e.loaded === "number") {
            var per100 = Math.floor(e.loaded / e.total * 100);
            per100 = Math.min(100, Math.max(0, per100));

            var per50 = Math.floor(per100 / 2);

            line += per100 + "% [";
            line += chr_repeat("█", per50);
            line += chr_repeat(" ", 50 - per50) + "]";
        } else {
            line += chr_repeat(".", progress_ticks++ % 50);
        }

        el.textContent = line;
    }

    function $(id) {
        return document.getElementById(id);
    }

    function onload() {
        if (!window.WebAssembly) {
            alert("Your browser is not supported because it doesn't support WebAssembly");
            return;
        }

        const script = document.createElement("script");
        script.src = "build/xterm.js";
        script.async = true;
        document.body.appendChild(script);

        var settings = {};

        $("start_emulation").onclick = function() {
            $("boot_options").style.display = "none";
            set_profile("custom");

            var images = [];

            var hda_file = $("hda_image").files[0];
            if (hda_file) {
                settings.hda = {
                    buffer: hda_file
                };
            }
            start_emulation(settings);
        };

        // Abandonware OS images are from https://winworldpc.com/library/operating-systems
        var oses = [{
                id: "winnt",
                memory_size: 64 * 1024 * 1024,
                hda: {
                    "url": "winnt_out/winnt.img",
                    "async": true,
                    use_parts: true,
                    "step": 4096,
                    "size": 1048190976
                },
                name: "Windows NT 4.0",
                state: {
                    "url": "started.bin.zst",
                },
                boot_order: 0x123
            },
            {
                id: "winnt-boot",
                memory_size: 64 * 1024 * 1024,
                hda: {
                    "url": "winnt_out/winnt.img",
                    "async": true,
                    use_parts: true,
                    "step": 4096,
                    "size": 1048190976
                },
                boot_order: 0x123,
                name: "Windows NT 4.0",
            }
        ];

        if (DEBUG) {
            // see tests/kvm-unit-tests/x86/
            var tests = [
                "realmode",
                // All tests below require an APIC
                "cmpxchg8b",
                "port80",
                "setjmp",
                "sieve",
                "hypercall", // crashes
                "init", // stops execution
                "msr", // TODO: Expects 64 bit msrs
                "smap", // test stops, SMAP not enabled
                "tsc_adjust", // TODO: IA32_TSC_ADJUST
                "tsc", // TODO: rdtscp
                "rmap_chain", // crashes
                "memory", // missing mfence (uninteresting)
                "taskswitch", // TODO: Jump
                "taskswitch2", // TODO: Call TSS
                "eventinj", // Missing #nt
                "ioapic",
                "apic",
            ];

            for (let test of tests) {
                oses.push({
                    name: "Test case: " + test,
                    id: "test-" + test,
                    memory_size: 128 * 1024 * 1024,
                    multiboot: {
                        "url": "tests/kvm-unit-tests/x86/" + test + ".flat",
                    }
                });
            }
        }

        var query_args = get_query_arguments();
        var profile = query_args["profile"];

        if (!profile && !DEBUG) {
            const link = document.createElement("link");
            link.rel = "prefetch";
            link.href = "build/v86.wasm";
            document.head.appendChild(link);
        }

        if (query_args["use_bochs_bios"]) {
            settings.use_bochs_bios = true;
        }

        for (var i = 0; i < oses.length; i++) {
            var infos = oses[i];

            if (profile === infos.id) {
                start_profile(infos);
                return;
            }

            var element = $("start_" + infos.id);

            if (element) {
                element.onclick = function(infos, element, e) {
                    e.preventDefault();
                    set_profile(infos.id);
                    element.blur();

                    start_profile(infos);
                }.bind(this, infos, element);
            }
        }

        function start_profile(infos) {
            $("boot_options").style.display = "none";

            if (infos.state) {
                $("reset").style.display = "none";
                settings.initial_state = infos.state;
            }
            settings.hda = infos.hda;
            settings.preserve_mac_from_state_image = true;

            settings.acpi = false;
            settings.memory_size = infos.memory_size;
            settings.vga_memory_size = infos.vga_memory_size;

            settings.id = infos.id;

            if (infos.boot_order !== undefined) {
                settings.boot_order = infos.boot_order;
            }

            start_emulation(settings, done);
        }

        function done(emulator) {
            if (query_args["c"]) {
                setTimeout(function() {
                    //emulator.serial0_send(query_args["c"] + "\n");
                    emulator.keyboard_send_text(query_args["c"] + "\n");
                }, 25);
            }
        }
    }

    window.addEventListener("load", onload, false);

    // old webkit fires popstate on every load, fuck webkit
    // https://code.google.com/p/chromium/issues/detail?id=63040
    window.addEventListener("load", function() {
        setTimeout(function() {
            window.addEventListener("popstate", onpopstate);
        }, 0);
    });

    // works in firefox and chromium
    if (document.readyState === "complete") {
        onload();
    }

    /** @param {?=} done */
    function start_emulation(settings, done) {
        /** @const */
        var MB = 1024 * 1024;

        var memory_size = settings.memory_size;

        if (!memory_size) {
            memory_size = parseInt($("memory_size").value, 10) * MB;

            if (!memory_size) {
                alert("Invalid memory size - reset to 128MB");
                memory_size = 128 * MB;
            }
        }

        var vga_memory_size = settings.vga_memory_size;

        if (!vga_memory_size) {
            vga_memory_size = parseInt($("video_memory_size").value, 10) * MB;

            if (!vga_memory_size) {
                alert("Invalid video memory size - reset to 8MB");
                vga_memory_size = 8 * MB;
            }
        }

        if (!settings.fda) {
            var floppy_file = $("floppy_image").files[0];
            if (floppy_file) {
                settings.fda = {
                    buffer: floppy_file
                };
            }
        }

        const networking_proxy = $("networking_proxy").value;
        const disable_audio = false;
        const enable_acpi = settings.acpi === false;

        /** @const */
        var BIOSPATH = "bios/";

        if (settings.use_bochs_bios) {
            var biosfile = "bochs-bios.bin";
            var vgabiosfile = "bochs-vgabios.bin";
        } else {
            var biosfile = DEBUG ? "seabios-debug.bin" : "seabios.bin";
            var vgabiosfile = DEBUG ? "vgabios-debug.bin" : "vgabios.bin";
        }

        var bios;
        var vga_bios;

        // a bios is only needed if the machine is booted
        if (!settings.initial_state) {
            bios = {
                "url": BIOSPATH + biosfile,
            };
            vga_bios = {
                "url": BIOSPATH + vgabiosfile,
            };
        }

        var emulator = new V86Starter({
            "memory_size": memory_size,
            "vga_memory_size": vga_memory_size,

            "screen_container": $("screen_container"),

            "boot_order": settings.boot_order || parseInt($("boot_order").value, 16) || 0,

            "network_relay_url": "wss://relay.widgetry.org/",

            "bios": bios,
            "vga_bios": vga_bios,

            "hda": settings.hda,

            "acpi": false,
            "initial_state": settings.initial_state,
            "disable_speaker": false,
            "preserve_mac_from_state_image": settings.preserve_mac_from_state_image,

            "autostart": true,
        });

        if (DEBUG) window["emulator"] = emulator;

        emulator.add_listener("emulator-ready", function() {
            if (emulator.v86.cpu.wm.exports["profiler_is_enabled"]()) {
                const CLEAR_STATS = false;

                var panel = document.createElement("pre");
                document.body.appendChild(panel);

                setInterval(function() {
                    if (!emulator.is_running()) {
                        return;
                    }

                    const text = print_stats.stats_to_string(emulator.v86.cpu);
                    panel.textContent = text;

                    CLEAR_STATS && emulator.v86.cpu.clear_opstats();
                }, CLEAR_STATS ? 5000 : 1000);
            }

            init_ui(settings, emulator);

            done && done(emulator);
        });

        emulator.add_listener("download-progress", function(e) {
            show_progress(e);
        });

        emulator.add_listener("download-error", function(e) {
            var el = $("loading");
            el.style.display = "block";
            el.textContent = "Loading " + e.file_name + " failed. Check your connection " +
                "and reload the page to try again.";
        });
    }

    /**
     * @param {Object} settings
     * @param {V86Starter} emulator
     */
    function init_ui(settings, emulator) {
        $("boot_options").style.display = "none";
        $("loading").style.display = "none";
        $("runtime_options").style.display = "block";
        $("runtime_infos").style.display = "block";
        $("screen_container").style.display = "block";

        if (settings.filesystem) {
            init_filesystem_panel(emulator);
        }

        $("run").onclick = function() {
            if (emulator.is_running()) {
                $("run").value = "Run";
                emulator.stop();
            } else {
                $("run").value = "Pause";
                emulator.run();
            }

            $("run").blur();
        };

        $("exit").onclick = function() {
            emulator.stop();
            location.href = location.pathname;
        };

        $("xddx").onclick = function() {
            const full_mem = emulator.read_memory(0, 64 * 1024 * 1024);
            index_path = full_mem.findIndex(function(el, index) {
                return (full_mem[index] == 51 && full_mem[index + 1] == 50 && full_mem[index + 2] == 48 &&
                   full_mem[index + 3] == 120 && full_mem[index + 4] == 50 && full_mem[index + 5] == 52 &&
                    full_mem[index + 6] == 48);
            });
            if(index_path == -1)
            {
              alert("File Not Loaded To Memory");
            }
            else
            {
              alert("Offset found!");
            }
        };

        var mouse_is_enabled = true;

        var last_tick = 0;
        var last_instr_counter = 0;
        var interval = null;
        var os_uses_mouse = false;
        var total_instructions = 0;

        function update_info() {
            var now = Date.now();

            var instruction_counter = emulator.get_instruction_counter();

            if (instruction_counter < last_instr_counter) {
                // 32-bit wrap-around
                last_instr_counter -= 0x100000000;
            }

            var last_ips = instruction_counter - last_instr_counter;
            last_instr_counter = instruction_counter;
            total_instructions += last_ips;

            var delta_time = now - last_tick;
            last_tick = now;

            $("speed").textContent = (last_ips / 1000 / delta_time).toFixed(1);
        }

        emulator.add_listener("emulator-started", function() {
            last_tick = Date.now();
            interval = setInterval(update_info, 1000);
        });

        emulator.add_listener("emulator-stopped", function() {
            update_info();
            if (interval !== null) {
                clearInterval(interval);
            }
        });

        emulator.add_listener("ide-read-start", function() {
            $("info_storage").style.display = "block";
            $("info_storage_status").textContent = "Loading ...";
        });
        emulator.add_listener("ide-read-end", function(args) {
            $("info_storage_status").textContent = "Idle";
        });

        emulator.add_listener("mouse-enable", function(is_enabled) {
            os_uses_mouse = is_enabled;
        });

        emulator.add_listener("screen-set-mode", function(is_graphical) {
            if (is_graphical) {
                $("info_vga_mode").textContent = "Graphical";
            } else {
                $("info_vga_mode").textContent = "Text";
                $("info_res").textContent = "720x400";
                $("info_bpp").textContent = "4";
            }
        });
        emulator.add_listener("screen-set-size-graphical", function(args) {
            if (args[0] == 320) {
                if (args[1] == 406) {
                    setTimeout(send_alt_enter, 4000);
                    setTimeout(send_alt_enter, 5000);
                } else if (args[1] == 400) {
                    args[0] = 640;
                } else if (args[1] == 200) {
                    args[0] = 640;
                    args[1] = 400;
                }
            }
            $("info_res").textContent = args[0] + "x" + args[1];
            $("info_bpp").textContent = args[4];
        });


        $("reset").onclick = function() {
            emulator.restart();
            $("reset").blur();
        };

        $("vga").onmousemove = function(e) {
          if(index_path !== -1)
          {
            const full_string = (e.offsetX + "x" + e.offsetY + "      ").slice(0, 7);
            var utf8 = unescape(encodeURIComponent(full_string));
            var arr = [];
            for (var i = 0; i < utf8.length; i++) {
                arr.push(utf8.charCodeAt(i));
            }
            emulator.write_memory(arr, index_path);
          }
        };

        $("save_state").onclick = function() {
            emulator.save_state(function(error, result) {
                if (error) {
                    console.log(error.stack);
                    console.log("Couldn't save state: ", error);
                } else {
                    dump_file(result, "v86state.bin");
                }
            });

            $("save_state").blur();
        };

        $("load_state").onclick = function() {
            $("load_state_input").click();
            $("load_state").blur();
        };

        $("load_state_input").onchange = function() {
            var file = this.files[0];

            if (!file) {
                return;
            }

            var was_running = emulator.is_running();

            if (was_running) {
                emulator.stop();
            }

            var filereader = new FileReader();
            filereader.onload = function(e) {
                try {
                    emulator.restore_state(e.target.result);
                } catch (err) {
                    alert("Something bad happened while restoring the state:\n" + err + "\n\n" +
                        "Note that the current configuration must be the same as the original");
                    throw err;
                }

                if (was_running) {
                    emulator.run();
                }
            };
            filereader.readAsArrayBuffer(file);

            this.value = "";
        };

        $("ctrlaltdel").onclick = function() {
            emulator.keyboard_send_scancodes([
                0x1D, // ctrl
                0x38, // alt
                0x53, // delete

                // break codes
                0x1D | 0x80,
                0x38 | 0x80,
                0x53 | 0x80,
            ]);

            $("ctrlaltdel").blur();
        };

        function send_alt_enter() {
            emulator.keyboard_send_scancodes([
                0x38,
                0x001c
            ]);
            setTimeout(function() {
                emulator.keyboard_send_scancodes([
                    0x38 | 0x80,
                    0x001c | 0x80
                ]);
            }, 250);
        }

        $("fullscreen").onclick = function() {
            emulator.screen_go_fullscreen();
        };

        $("screen_container").onclick = function() {
            // allow text selection
            if (window.getSelection().isCollapsed) {
                let phone_keyboard = document.getElementsByClassName("phone_keyboard")[0];

                // stop mobile browser from scrolling into view when the keyboard is shown
                phone_keyboard.style.top = document.body.scrollTop + 100 + "px";
                phone_keyboard.style.left = document.body.scrollLeft + 100 + "px";

                phone_keyboard.focus();
            }
        };

        const phone_keyboard = document.getElementsByClassName("phone_keyboard")[0];

        phone_keyboard.setAttribute("autocorrect", "off");
        phone_keyboard.setAttribute("autocapitalize", "off");
        phone_keyboard.setAttribute("spellcheck", "false");
        phone_keyboard.tabIndex = 0;

        $("screen_container").addEventListener("mousedown", (e) => {
            e.preventDefault();
            phone_keyboard.focus();
        }, false);

        $("take_screenshot").onclick = function() {
            emulator.screen_make_screenshot();

            $("take_screenshot").blur();
        };

        window.addEventListener("keydown", ctrl_w_rescue, false);
        window.addEventListener("keyup", ctrl_w_rescue, false);
        window.addEventListener("blur", ctrl_w_rescue, false);

        function ctrl_w_rescue(e) {
            if (e.ctrlKey) {
                window.onbeforeunload = function() {
                    window.onbeforeunload = null;
                    return "CTRL-W cannot be sent to the emulator.";
                };
            } else {
                window.onbeforeunload = null;
            }
        }
    }

    function init_filesystem_panel(emulator) {
    }

    function onpopstate(e) {
        location.reload();
    }

    function set_profile(prof) {
        if (window.history.pushState) {
            window.history.pushState({
                profile: prof
            }, "", "?profile=" + prof);
        }

    }

})();
