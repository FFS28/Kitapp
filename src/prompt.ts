/* eslint-disable no-restricted-syntax */
/* eslint-disable no-underscore-dangle */
/* eslint-disable no-nested-ternary */
/* eslint-disable no-bitwise */
/* eslint-disable @typescript-eslint/no-use-before-define */
/* eslint-disable import/prefer-default-export */
import { Channel, Mode, ProcessType, UI } from '@johnlindquist/kit/cjs/enum';
import { Choice, Script, PromptData, PromptBounds } from '@johnlindquist/kit';

import { BrowserWindow, screen, nativeTheme, app } from 'electron';
import log from 'electron-log';
import { debounce } from 'lodash';
import minimist from 'minimist';
import { readFileSync } from 'fs';
import {
  mainScriptPath,
  isFile,
  kenvPath,
  kitPath,
} from '@johnlindquist/kit/cjs/utils';
import { getPromptDb } from '@johnlindquist/kit/cjs/db';
import { Display } from 'electron/main';
import { getAssetPath } from './assets';
// import { Channel, Mode, UI } from '@johnlindquist/kit';
import { getAppHidden } from './appHidden';
import { getScriptsMemory } from './state';
import { emitter, KitEvent } from './events';
import {
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  heightMap,
  MIN_HEIGHT,
  MIN_WIDTH,
} from './defaults';
import { ResizeData } from './types';

let promptScript: Script;
let promptWindow: BrowserWindow;
let blurredByKit = false;
let ignoreBlur = false;

export const setBlurredByKit = (value = true) => {
  blurredByKit = value;
};

export const setIgnoreBlur = (value = true) => {
  ignoreBlur = value;
};

const miniArgs = minimist(process.argv);
const { devTools } = miniArgs;
log.info(process.argv.join(' '), devTools);

export const createPromptWindow = async () => {
  promptWindow = new BrowserWindow({
    useContentSize: true,
    frame: false,
    transparent: true,
    vibrancy: 'menu',
    visualEffectState: 'active',
    show: false,
    hasShadow: true,
    icon: getAssetPath('icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      devTools: process.env.NODE_ENV === 'development' || devTools,
      backgroundThrottling: false,
    },
    alwaysOnTop: true,
    closable: false,
    minimizable: false,
    maximizable: false,
    movable: true,
    skipTaskbar: true,
    minHeight: 64,
  });

  promptWindow.setAlwaysOnTop(true, 'floating', 1);
  promptWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  promptWindow.loadURL(`file://${__dirname}/index.html`);

  promptWindow.webContents.once('did-finish-load', () => {
    promptWindow?.webContents.closeDevTools();
  });

  promptWindow?.setMaxListeners(2);

  // promptWindow?.webContents.on('before-input-event', (event: any, input) => {
  //   if (input.key === 'Escape') {
  //     if (promptWindow) escapePromptWindow(promptWindow);
  //   }
  // });

  promptWindow.on('focus', () => {
    // sendToPrompt(Channel.SET_THEME, {
    //   '--opacity-themedark': '33%',
    //   '--opacity-themelight': '33%',
    // });
    promptWindow?.setVibrancy('menu');
  });

  promptWindow.on('hide', () => {
    lastResizedByUser = false;
    ignoreBlur = false;
  });

  promptWindow?.on('blur', () => {
    if (promptScript?.filePath !== mainScriptPath && ignoreBlur) {
      // sendToPrompt(Channel.SET_THEME, {
      //   '--opacity-themedark': '0%',
      //   '--opacity-themelight': '0%',
      // });
      promptWindow?.setVibrancy('popover');
    } else {
      hidePromptWindow();
    }

    if (
      !ignoreBlur &&
      !getAppHidden() &&
      !promptWindow?.webContents.isDevToolsOpened()
    ) {
      emitter.emit(KitEvent.Blur);
    }
  });

  const onMove = async () => {
    await cachePromptBounds(Bounds.Position);
  };

  const onResized = async () => {
    lastResizedByUser = false;
    await cachePromptBounds(Bounds.Size);
  };

  promptWindow?.on('will-resize', () => {
    lastResizedByUser = true;
  });
  promptWindow?.on('resized', debounce(onResized, 500));
  promptWindow?.on('move', debounce(onMove, 500));

  // setInterval(() => {
  //   const [, newHeight] = promptWindow?.getSize() as number[];
  //   const { height: boundsHeight } = promptWindow?.getBounds() as Rectangle;
  //   const {
  //     height: normalBoundsHeight,
  //   } = promptWindow?.getNormalBounds() as Rectangle;
  //   const {
  //     height: contentBoundsHeight,
  //   } = promptWindow?.getContentBounds() as Rectangle;
  //   log.info(
  //     `REPORTING HEIGHT: `,
  //     newHeight,
  //     boundsHeight,
  //     normalBoundsHeight,
  //     contentBoundsHeight
  //   );
  // }, 2000);

  return promptWindow;
};

export const setPromptProp = (data: { prop: { key: string; value: any } }) => {
  const { key, value }: any = data.prop;
  (promptWindow as any)[key](value);
};

export const focusPrompt = () => {
  if (promptWindow && !promptWindow.isDestroyed()) {
    promptWindow?.focus();
  }
};

export const escapePromptWindow = () => {
  promptScript = {
    command: '',
    filePath: '',
    type: ProcessType.Prompt,
    kenv: '',
    requiresPrompt: false,
    name: '',
  };
  blurredByKit = false;
  hideAppIfNoWindows();
};

const getCurrentScreen = (): Display => {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
};

export const getCurrentScreenPromptCache = async () => {
  const currentScreen = getCurrentScreen();
  const promptDb = await getPromptDb();

  const screenCache = promptDb.screens?.[String(currentScreen.id)];

  const currentPromptCache = screenCache?.[promptScript?.filePath as string];

  if (currentPromptCache) return currentPromptCache;

  const bounds = await resetPromptBounds();
  return bounds;
};

const guessTopHeight = (script: Script) => {
  let height = 0;
  if (script?.description || script?.twitter || script?.menu) {
    height += 24;
  }
  if (script?.description && script?.twitter) {
    height += 12;
  }

  height += 64;

  if (script?.tabs?.length) {
    height += 12;
  }

  return height;
};

export const getDefaultBounds = (currentScreen: Display) => {
  const { width: screenWidth, height: screenHeight } =
    currentScreen.workAreaSize;

  const height = Math.round(
    promptScript?.filePath.includes(kitPath()) || instantChoices.length
      ? DEFAULT_HEIGHT
      : currentUI === UI.arg
      ? guessTopHeight(promptScript)
      : heightMap[currentUI]
  ); // Math.round(screenHeight / 1.5);

  const width = DEFAULT_WIDTH; // Math.round(height * (8.5 / 11));
  const { x: workX, y: workY } = currentScreen.workArea;
  const x = Math.round(screenWidth / 2 - width / 2 + workX);
  const y = Math.round(workY + screenHeight / 8);

  return { id: currentScreen.id, bounds: { x, y, width, height } };
};

export const showPrompt = async () => {
  if (!promptWindow?.isVisible()) {
    const bounds = await getCurrentScreenPromptCache();
    log.info(`↖ BOUNDS:`, bounds);
    promptWindow.setBounds(bounds);

    promptWindow?.show();
    promptWindow?.focus();
    promptWindow?.focusOnWebView();
    if (devTools) promptWindow?.webContents.openDevTools();
  }

  return promptWindow;
};

let lastResizedByUser = false;

export const resize = debounce(
  async ({
    topHeight,
    mainHeight,
    ui,
    filePath,
    mode,
    hasChoices,
    hasPanel,
    hasInput,
    open,
  }: ResizeData) => {
    const sameScript = filePath === promptScript?.filePath;
    if (lastResizedByUser || !sameScript) return;
    if (!mainHeight && ui & (UI.form | UI.div | UI.editor | UI.drop)) return;
    // if (!mainHeight && hasPanel) return;
    if (!mainHeight && !hasInput && hasChoices) return;
    if (!promptWindow?.isVisible() || !open) return;

    const cachedBounds = await getCurrentScreenPromptCache();
    const bounds = promptWindow.getBounds();

    const targetHeight = topHeight + mainHeight;
    // const y = Math.round(workY + screenHeight / 8);
    const maxHeight =
      hasPanel ||
      mode === Mode.GENERATE ||
      ui & (UI.form | UI.div | UI.editor | UI.hotkey)
        ? Math.round(getCurrentScreen().bounds.height * (3 / 4))
        : Math.max(cachedBounds.height, heightMap[ui]);

    const height = Math.round(
      targetHeight > maxHeight ? maxHeight : targetHeight
    );
    // console.log({
    //   topHeight,
    //   mainHeight,
    //   ui,
    //   hasChoices,
    //   hasInput,
    //   mode,
    //   maxHeight,
    // });

    // console.log({ cached: cachedBounds.height, bounds: bounds.height, height });
    if (bounds.height === height) return;
    log.info(`↕ RESIZE: ${cachedBounds.width} x ${height}`);
    promptWindow.setSize(cachedBounds.width, height);

    if (ui !== UI.arg) cachePromptBounds(Bounds.Size);
  },
  0
);

export const resetPromptBounds = async () => {
  const currentScreen = getCurrentScreen();
  const promptDb = await getPromptDb();

  const { id, bounds } = getDefaultBounds(currentScreen);
  if (!promptDb.screens[String(currentScreen.id)])
    promptDb.screens[String(currentScreen.id)] = {};
  promptDb.screens[String(currentScreen.id)][promptScript.filePath] = bounds;
  await promptDb.write();

  promptWindow?.setBounds(bounds);

  return bounds;
};

export const sendToPrompt = (channel: string, data: any) => {
  // log.info(`>_ ${channel} ${data?.kitScript}`);
  if (promptWindow && !promptWindow.isDestroyed()) {
    promptWindow?.webContents.send(channel, data);
  }
};

enum Bounds {
  Position = 1 << 0,
  Size = 1 << 1,
}

const cachePromptBounds = debounce(
  async (b = Bounds.Position | Bounds.Size) => {
    if (!promptScript) return;
    const currentScreen = getCurrentScreen();
    const promptDb = await getPromptDb();

    const bounds = promptWindow?.getBounds();
    const prevBounds =
      promptDb.screens?.[String(currentScreen.id)]?.[promptScript.filePath] ||
      bounds;
    // Ignore if flag
    const size = b & Bounds.Size;
    const position = b & Bounds.Position;

    const { x, y } = position ? bounds : prevBounds;
    const { width, height } = size ? bounds : prevBounds;

    const promptBounds: PromptBounds = {
      x,
      y,
      width: width < MIN_WIDTH ? MIN_WIDTH : width,
      height: height < MIN_HEIGHT ? MIN_HEIGHT : height,
    };

    promptDb.screens[String(currentScreen.id)][promptScript.filePath] =
      promptBounds;

    log.info(`Cache prompt:`, {
      script: promptScript.filePath,
      screen: currentScreen.id,
      ...promptBounds,
    });

    await promptDb.write();
  },
  100
);

const hideAppIfNoWindows = () => {
  if (promptWindow?.isVisible()) {
    const allWindows = BrowserWindow.getAllWindows();
    // Check if all other windows are hidden

    promptWindow?.hide();
    // setPromptBounds();

    if (allWindows.every((window) => !window.isVisible())) {
      app?.hide();
    }
  }
};

export const hidePromptWindow = () => {
  if (promptWindow?.webContents.isDevToolsFocused()) return;

  if (blurredByKit) {
    blurredByKit = false;
    return;
  }

  hideAppIfNoWindows();

  blurredByKit = false;
};

export const setPlaceholder = (text: string) => {
  // if (!getAppHidden())
  sendToPrompt(Channel.SET_PLACEHOLDER, text);
};

let promptPid = 0;

export const getPromptPid = () => promptPid;

export const setPromptPid = (pid: number) => {
  promptPid = pid;
  sendToPrompt(Channel.SET_PID, pid);
};

let instantChoices = [];

export const setScript = async (script: Script) => {
  if (promptScript?.filePath === script?.filePath) return;
  promptScript = script;

  // if (promptScript?.id === script?.id) return;
  // log.info(script);

  if (script.filePath === mainScriptPath) {
    script.tabs = script?.tabs?.filter((tab) => !tab.match(/join|live/i));
  }

  sendToPrompt(Channel.SET_SCRIPT, script);

  instantChoices = [];
  if (script.filePath === mainScriptPath) {
    sendToPrompt(Channel.SET_PLACEHOLDER, 'Run script');
    instantChoices = getScriptsMemory();
  } else if (script.requiresPrompt) {
    const maybeCachedChoices = kenvPath(
      script?.kenv ? `kenvs/${script.kenv}` : ``,
      'db',
      `_${script.command}.json`
    );
    if (await isFile(maybeCachedChoices)) {
      const choicesFile = readFileSync(maybeCachedChoices, 'utf-8');
      const { items } = JSON.parse(choicesFile);
      log.info(`📦 Setting choices from ${maybeCachedChoices}`);
      instantChoices = items.map((item: string | Choice, id: number) =>
        typeof item === 'string' ? { name: item, id } : item
      );
    }
  }
  log.info({ length: instantChoices.length, path: script.filePath });

  if (instantChoices.length) setChoices(instantChoices);
};

export const setMode = (mode: Mode) => {
  sendToPrompt(Channel.SET_MODE, mode);
};

export const setInput = (input: string) => {
  sendToPrompt(Channel.SET_INPUT, input);
};

export const setPanel = (html: string) => {
  sendToPrompt(Channel.SET_PANEL, html);
};

export const setLog = (_log: string) => {
  sendToPrompt(Channel.SET_LOG, _log);
};

export const setHint = (hint: string) => {
  sendToPrompt(Channel.SET_HINT, hint);
};

export const setTabIndex = (tabIndex: number) => {
  sendToPrompt(Channel.SET_TAB_INDEX, tabIndex);
};

let currentUI: UI;
export const setPromptData = async (promptData: PromptData) => {
  currentUI = promptData.ui;
  sendToPrompt(Channel.SET_PROMPT_DATA, promptData);
  await showPrompt();
};

export const setChoices = (choices: Choice[]) => {
  sendToPrompt(Channel.SET_CHOICES, choices);
};

export const clearPromptCache = async () => {
  const promptDb = await getPromptDb();
  promptDb.screens = {};
  await promptDb.write();
};

emitter.on(KitEvent.ExitPrompt, () => {
  escapePromptWindow();
});

export const reload = () => {
  promptWindow?.reload();
};
