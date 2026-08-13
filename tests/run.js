#!/usr/bin/env -S gjs -m
//
// The headless suite: everything that can be tested without a compositor. Run it with
//
//     gjs -m tests/run.js
//
// Each suite imports only GLib/Gio, never gi://St or resource:///org/gnome/shell, so this
// is exactly the code the extension runs and not a copy of it.

import './metadata.test.js';
import './contract.test.js';
import './fixtures.test.js';
import './document.test.js';
import './rows.test.js';
import './summary.test.js';
import './recap.test.js';
import './source.test.js';
import './menu.test.js';
import './scheduler.test.js';
import './hygiene.test.js';
import './preferences.test.js';
import './resume.test.js';
import './attention.test.js';
import './events.test.js';
import './eventService.test.js';
import './hooks.test.js';
import './sources.test.js';

import { run } from './harness.js';

imports.system.exit(run());
