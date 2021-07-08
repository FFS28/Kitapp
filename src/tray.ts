/* eslint-disable import/prefer-default-export */
import { Tray } from 'electron';
import log from 'electron-log';
import { KeyboardEvent } from 'electron/main';
import { kenvPath, kitPath, mainScriptPath } from 'kit-bridge/cjs/util';
import { getAssetPath } from './assets';
import { restartIfNecessary } from './state';
import { runPromptProcess } from './kit';

let tray: Tray | null = null;

const leftClick = async (event: KeyboardEvent) => {
  await restartIfNecessary();
  if (event.metaKey) {
    runPromptProcess(kenvPath('app', 'command-click.js'));
  } else if (event.shiftKey) {
    runPromptProcess(kenvPath('app', 'shift-click.js'));
  } else if (event.ctrlKey) {
    runPromptProcess(kenvPath('app', 'control-click.js'));
  } else if (event.altKey) {
    runPromptProcess(kenvPath('app', 'alt-click.js'));
  } else {
    runPromptProcess(mainScriptPath);
  }
};

const rightClick = async () => {
  runPromptProcess(kitPath('main', 'kit.js'));
};

const trayIcon = getAssetPath('IconTemplate.png');

export const createTray = async () => {
  try {
    tray = new Tray(trayIcon);
    tray.setIgnoreDoubleClickEvents(true);

    tray.on('click', leftClick);
    tray.on('right-click', rightClick);
  } catch (error) {
    log.error(error);
  }

  return 'tray created';
};

export const destroyTray = () => {
  tray = null;
};
