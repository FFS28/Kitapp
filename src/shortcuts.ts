import { app, globalShortcut } from 'electron';
import log from 'electron-log';
import { readFile } from 'fs/promises';
import { Script } from '@johnlindquist/kit/types/core';
import { subscribeKey } from 'valtio/utils';

import {
  mainScriptPath,
  shortcutsPath,
  shortcutNormalizer,
} from '@johnlindquist/kit/cjs/utils';
import { runPromptProcess } from './kit';
import { emitter, KitEvent } from './events';
import { focusPrompt, isFocused, isVisible, reload } from './prompt';
import { kitState, subs } from './state';
import { Trigger } from './enums';

const registerShortcut = (shortcut: string, filePath: string) => {
  try {
    const success = globalShortcut.register(shortcut, async () => {
      runPromptProcess(filePath, [], {
        force: true,
        trigger: Trigger.Shortcut,
      });
      focusPrompt();
    });

    if (!success) {
      log.info(`Failed to register: ${shortcut} to ${filePath}`);
    }

    return success;
  } catch (error) {
    return false;
  }
};

export const registerTrayShortcut = () => {
  const success = globalShortcut.register('CommandOrControl+Shift+;', () => {
    emitter.emit(KitEvent.TrayClick);
  });

  if (process.env.NODE_ENV === 'development') {
    globalShortcut.register('Option+;', async () => {
      reload();
      // wait for reload to finish
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await runPromptProcess(mainScriptPath, [], {
        force: true,
        trigger: Trigger.Menu,
      });
    });
  }

  log.verbose(`Tray shortcut registered: ${success ? 'success' : 'fail'}`);
};

// const success = globalShortcut.register(``, async () => {
//   runPromptProcess(filePath);
//   focusPrompt();
// });

// if (!success) {
//   log.info(`Failed to register: ${shortcut} to ${filePath}`);
// }

// return success;

export const shortcutMap = new Map();

export const unlinkShortcuts = (filePath: string) => {
  const oldShortcut = shortcutMap.get(filePath);

  if (oldShortcut) {
    globalShortcut.unregister(oldShortcut);
    shortcutMap.delete(filePath);
  }
};

export const shortcutScriptChanged = ({
  shortcut,
  filePath,
  friendlyShortcut,
}: Script) => {
  const oldShortcut = shortcutMap.get(filePath);
  const sameScript = oldShortcut === shortcut;

  // Handle existing shortcuts

  const exists = [...shortcutMap.entries()].find(([, s]) => s === shortcut);
  if (exists && !sameScript) {
    kitState.status = {
      status: 'warn',
      message: `${friendlyShortcut} already registered. Ignoring...`,
    };

    return;
  }

  if (oldShortcut) {
    // No change
    if (sameScript) {
      const message = `${shortcut} is already registered to ${filePath}`;
      log.info(message);

      return;
    }

    // User removed an existing shortcut
    globalShortcut.unregister(oldShortcut);
    shortcutMap.delete(filePath);
    log.info(`Unregistered ${oldShortcut} from ${filePath}`);
  }

  if (!shortcut) return;
  // At this point, we know it's a new shortcut, so register it

  const registerSuccess = registerShortcut(shortcut, filePath);

  if (registerSuccess && globalShortcut.isRegistered(shortcut)) {
    log.info(`Registered ${shortcut} to ${filePath}`);
    shortcutMap.set(filePath, shortcut);
  }
};

export const updateMainShortcut = async (filePath: string) => {
  log.info(`Updating main shortcut for ${filePath}`);
  if (filePath === shortcutsPath) {
    log.info(`SHORTCUTS DB CHANGED:`, filePath);
    const settings = JSON.parse(await readFile(filePath, 'utf-8'));
    const rawShortcut = settings?.shortcuts?.[mainScriptPath];

    const shortcut = rawShortcut ? shortcutNormalizer(rawShortcut) : '';

    if (shortcut) {
      const oldShortcut = shortcutMap.get(mainScriptPath);

      if (shortcut === oldShortcut) return;

      if (oldShortcut) {
        globalShortcut.unregister(oldShortcut);
        shortcutMap.delete(mainScriptPath);
      }

      const ret = globalShortcut.register(shortcut, async () => {
        log.info(`????  main shortcut`);
        if (isVisible() && !isFocused()) {
          focusPrompt();
          app.focus({
            steal: true,
          });
        } else {
          await runPromptProcess(mainScriptPath, [], {
            force: true,
            trigger: Trigger.Menu,
          });
        }
      });

      if (!ret) {
        log.warn(`Failed to register: ${shortcut} to ${mainScriptPath}`);
      }

      if (ret && globalShortcut.isRegistered(shortcut)) {
        kitState.mainShortcut = shortcut;
        log.info(`Registered ${shortcut} to ${mainScriptPath}`);
        shortcutMap.set(mainScriptPath, shortcut);
      }
    }
  }
};

const pauseShortcuts = () => {
  log.info(`PAUSING GLOBAL SHORTCUTS`);
  globalShortcut.unregisterAll();
};

const resumeShortcuts = () => {
  log.info(`RESUMING GLOBAL SHORTCUTS`);
  shortcutMap.forEach(registerShortcut);
};

const subShortcutsPaused = subscribeKey(
  kitState,
  'shortcutsPaused',
  (shortcutsPaused) => {
    if (shortcutsPaused) {
      pauseShortcuts();
    } else {
      resumeShortcuts();
    }
  }
);

subs.push(subShortcutsPaused);
