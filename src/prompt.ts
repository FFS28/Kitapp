/* eslint-disable no-restricted-syntax */
/* eslint-disable no-underscore-dangle */
/* eslint-disable no-nested-ternary */
/* eslint-disable no-bitwise */
/* eslint-disable @typescript-eslint/no-use-before-define */
/* eslint-disable import/prefer-default-export */
import { Channel, Mode, UI } from '@johnlindquist/kit/cjs/enum';
import {
  Choice,
  Script,
  PromptData,
  PromptBounds,
} from '@johnlindquist/kit/types/core';
import { BrowserWindow, screen, app, Rectangle } from 'electron';
import os from 'os';
import path from 'path';
import log from 'electron-log';
import { debounce, lowerFirst } from 'lodash';
import minimist from 'minimist';
import { mainScriptPath, kitPath } from '@johnlindquist/kit/cjs/utils';
import { ChannelMap } from '@johnlindquist/kit/types/kitapp';
import { getPromptDb } from '@johnlindquist/kit/cjs/db';
import { Display } from 'electron/main';
import { getAssetPath } from './assets';

// import { Channel, Mode, UI } from '@johnlindquist/kit';
import { getAppHidden } from './appHidden';
import { getScriptsMemory } from './state';
import { emitter, KitEvent } from './events';
import {
  DEFAULT_EXPANDED_WIDTH,
  DEFAULT_HEIGHT,
  heightMap,
  INPUT_HEIGHT,
  MIN_HEIGHT,
  MIN_WIDTH,
  noScript,
  SPLASH_PATH,
} from './defaults';
import { ResizeData } from './types';
import { getVersion } from './version';

let promptScript: Script = noScript;
let promptWindow: BrowserWindow;
let blurredByKit = false;
let ignoreBlur = false;
let minHeight = MIN_HEIGHT;

export const setBlurredByKit = (value = true) => {
  blurredByKit = value;
};

export const setIgnoreBlur = (value = true) => {
  ignoreBlur = value;
};

const miniArgs = minimist(process.argv);
const { devTools } = miniArgs;
// log.info(process.argv.join(' '), devTools);

export const createPromptWindow = async () => {
  const isMac = os.platform() === 'darwin';
  promptWindow = new BrowserWindow({
    useContentSize: true,
    frame: false,
    transparent: isMac,
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
    closable: false,
    minimizable: false,
    maximizable: false,
    movable: true,
    skipTaskbar: true,
    minHeight: INPUT_HEIGHT,
  });

  promptWindow.setAlwaysOnTop(false, 'floating', 1);
  promptWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  await promptWindow.loadURL(`file://${__dirname}/index.html`);

  sendToPrompt(Channel.APP_CONFIG, {
    delimiter: path.delimiter,
    sep: path.sep,
    os: os.platform(),
    isMac: os.platform().startsWith('darwin'),
    isWin: os.platform().startsWith('win'),
    assetPath: getAssetPath(),
    version: getVersion(),
  });

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
    modifiedByUser = false;
    ignoreBlur = false;
  });

  promptWindow?.on('blur', () => {
    if (os.platform().startsWith('win')) {
      return;
    }
    if (promptScript?.filePath !== mainScriptPath && ignoreBlur) {
      // sendToPrompt(Channel.SET_THEME, {
      //   '--opacity-themedark': '0%',
      //   '--opacity-themelight': '0%',
      // });
      promptWindow?.setVibrancy('popover');
    } else if (!ignoreBlur) {
      hidePromptWindow();
    }

    if (
      !ignoreBlur &&
      !getAppHidden() &&
      !promptWindow?.webContents.isDevToolsOpened()
    ) {
      emitter.emit(KitEvent.Blur);
    }

    if (!isMac)
      sendToPrompt(Channel.SET_THEME, {
        '--opacity-themedark': '100%',
        '--opacity-themelight': '100%',
      });
  });

  const onMove = async () => {
    if (modifiedByUser) await cachePromptBounds(Bounds.Position);
    modifiedByUser = false;
  };

  const onResized = async () => {
    if (modifiedByUser) await cachePromptBounds(Bounds.Size);
    modifiedByUser = false;
  };

  promptWindow?.on('will-resize', () => {
    modifiedByUser = true;
  });

  promptWindow?.on('will-move', () => {
    modifiedByUser = true;
  });
  promptWindow?.on('resized', debounce(onResized, 500));
  promptWindow?.on('moved', debounce(onMove, 500));

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

  promptWindow?.on('show', () => {
    setTimeout(() => {
      focusPrompt();
    }, 150);
  });

  return promptWindow;
};

export const setPromptProp = (data: { prop: { key: string; value: any } }) => {
  const { key, value }: any = data.prop;
  (promptWindow as any)[key](value);
};

export const focusPrompt = () => {
  if (promptWindow && !promptWindow.isDestroyed()) {
    log.info(`👓 Focus Prompt`);

    promptWindow?.focus();
    promptWindow?.focusOnWebView();
  }
};

export const escapePromptWindow = async () => {
  await cachePromptBounds(Bounds.Position);
  // promptScript = {
  //   id: '',
  //   command: '',
  //   filePath: '',
  //   type: ProcessType.Prompt,
  //   kenv: '',
  //   requiresPrompt: false,
  //   name: '',
  // };
  blurredByKit = false;
  hideAppIfNoWindows();
};

export const getCurrentScreen = (): Display => {
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

  height += INPUT_HEIGHT;

  if (script?.tabs?.length) {
    height += 12;
  }

  return height;
};

export const getDefaultBounds = (currentScreen: Display) => {
  const isSplash = promptScript?.filePath === SPLASH_PATH;
  const { width: screenWidth, height: screenHeight } =
    currentScreen.workAreaSize;

  const height = isSplash
    ? DEFAULT_HEIGHT
    : Math.max(
        minHeight,
        Math.round(
          promptScript?.filePath?.includes(kitPath()) || instantChoices.length
            ? DEFAULT_HEIGHT
            : currentUI === UI.arg
            ? guessTopHeight(promptScript)
            : heightMap[currentUI]
        )
      ); // Math.round(screenHeight / 1.5);

  const width = DEFAULT_EXPANDED_WIDTH;
  const { x: workX, y: workY } = currentScreen.workArea;
  const x = Math.round(screenWidth / 2 - width / 2 + workX);
  const y = Math.round(workY + screenHeight / 8);

  const bounds = { x, y, width, height };

  return { id: currentScreen.id, bounds };
};

export const showPrompt = async () => {
  if (!promptWindow?.isVisible()) {
    const bounds = await getCurrentScreenPromptCache();
    log.info(`↖ OPEN:`, bounds);
    promptWindow.setBounds(bounds);

    promptWindow?.show();
    if (devTools) promptWindow?.webContents.openDevTools();
  }

  if (currentUI === UI.splash || ignoreBlur) {
    promptWindow.setAlwaysOnTop(false, 'floating', 1);
  } else {
    promptWindow.setAlwaysOnTop(true, 'floating', 1);
  }

  focusPrompt();

  return promptWindow;
};

let modifiedByUser = false;

export const setBounds = (bounds: Partial<Rectangle>) => {
  promptWindow.setBounds(bounds);
  cachePromptBounds();
};

let prevResize = false;

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
    isPreviewOpen,
    previewEnabled,
    tabIndex,
    isSplash,
  }: ResizeData) => {
    // log.info(`RESIZE:`, {
    //   topHeight,
    //   mainHeight,
    //   ui,
    //   filePath,
    //   mode,
    //   hasChoices,
    //   hasPanel,
    //   hasInput,
    //   isPreviewOpen,
    //   previewEnabled,
    //   open,
    //   tabIndex,
    //   isSplash,
    // });

    if (!promptScript.resize && !prevResize) {
      prevResize = false;
      return;
    }
    minHeight = topHeight;

    const sameScript = filePath === promptScript?.filePath;
    if (modifiedByUser || !sameScript) return;

    if (!mainHeight && ui & (UI.form | UI.div | UI.editor | UI.drop)) return;
    // if (!mainHeight && hasPanel) return;
    if (!mainHeight && !hasInput && hasChoices) return;
    // if (mainHeight && ui & UI.arg && !hasPanel && !hasChoices) mainHeight = 0;
    // if (!promptWindow?.isVisible() || !open) return;

    // console.log({
    //   hasPreview: promptScript?.hasPreview,
    //   isPreviewOpen,
    //   previewEnabled,
    // });

    // log.info(
    //   `getCurrentScreenPromptCache`,
    //   promptScript,
    //   { isPreviewOpen },
    //   { isSplash }
    // );

    const {
      width: cachedWidth,
      height: cachedHeight,
      x: cachedX,
      y: cachedY,
    } = await getCurrentScreenPromptCache();
    const {
      width: currentWidth,
      height: currentHeight,
      x: currentX,
      y: currentY,
    } = promptWindow.getBounds();

    const targetHeight = topHeight + mainHeight;
    // console.log({
    //   topHeight,
    //   mainHeight,
    //   targetHeight,
    //   hasChoices,
    //   hasPanel,
    //   isPreviewOpen,
    // });
    // const y = Math.round(workY + screenHeight / 8);

    // const maxHeight =
    //   hasPanel || mode === Mode.GENERATE || ui & (UI.form | UI.div | UI.editor)
    //     ? Math.round(getCurrentScreen().bounds.height * (3 / 4))
    //     : Math.max(cachedHeight, heightMap[ui]);

    const maxHeight =
      hasPanel ||
      (mode === Mode.GENERATE && !previewEnabled) ||
      ui & (UI.form | UI.div)
        ? Math.round(getCurrentScreen().bounds.height * (3 / 4))
        : Math.max(DEFAULT_HEIGHT, cachedHeight);

    let width = isPreviewOpen
      ? Math.max(cachedWidth, DEFAULT_EXPANDED_WIDTH)
      : cachedWidth;

    let height = isPreviewOpen
      ? maxHeight
      : Math.round(targetHeight > maxHeight ? maxHeight : targetHeight);
    // console.log({ targetHeight, maxHeight, height });
    // console.log({ currentHeight, height, currentWidth, width });
    // log.info(`resize`, promptScript, promptState);
    if (isSplash) {
      width = DEFAULT_EXPANDED_WIDTH;
      height = DEFAULT_HEIGHT;
    }
    if (currentHeight === height && currentWidth === width) return;
    log.info(`↕ RESIZE: ${width} x ${height}`);
    promptWindow.setSize(width, height);
    prevResize = true;

    if (ui !== UI.arg) cachePromptBounds(Bounds.Size);

    if (ui === UI.arg && !tabIndex && !hasInput) {
      cachePromptBounds(Bounds.Size);
    }

    if (currentX !== cachedX && currentY !== cachedY) {
      promptWindow.setPosition(cachedX, cachedY);
    }
  },
  0
);

export const promptDbWrite = debounce(async (promptDb) => {
  await promptDb.write();
}, 250);

export const resetPromptBounds = async () => {
  if (
    !promptScript.resize &&
    ![mainScriptPath, SPLASH_PATH].includes(promptScript.filePath)
  ) {
    return promptWindow?.getBounds();
  }
  const currentScreen = getCurrentScreen();
  const promptDb = await getPromptDb();
  const screenId = String(currentScreen.id).slice();
  const filePath = (promptScript?.filePath || mainScriptPath).slice();

  const { id, bounds } = getDefaultBounds(currentScreen);
  if (!promptDb?.screens[screenId]) {
    promptDb.screens[screenId] = {};
  }
  const boundsFilePath = promptDb.screens?.[screenId]?.[filePath];
  const maybeBounds = boundsFilePath || {};

  if (!boundsFilePath) {
    const promptBounds = {
      ...bounds,
      x: maybeBounds?.x || bounds.x,
      y: maybeBounds?.y || bounds.y,
    };

    // console.log({ screenId, maybeBounds, promptBounds, bounds });
    promptDb.screens[screenId][filePath] = promptBounds;

    promptDbWrite(promptDb);

    // console.log(`⛑ Reset prompt bounds:`, promptBounds);
    // promptWindow?.setBounds(promptBounds);
    // promptWindow?.setPosition(promptBounds.x, promptBounds.y);
  }

  return bounds;
};

export const sendToPrompt = <K extends keyof ChannelMap>(
  channel: K,
  data?: ChannelMap[K]
) => {
  // log.info(`>_ ${channel} ${data?.kitScript}`);
  if (
    promptWindow &&
    promptWindow?.webContents &&
    !promptWindow.isDestroyed()
  ) {
    promptWindow?.webContents.send(channel, data);
  }
};

enum Bounds {
  Position = 1 << 0,
  Size = 1 << 1,
}

const cachePromptBounds = debounce(
  async (b: number = Bounds.Position | Bounds.Size) => {
    if (!promptScript) return;
    const currentScreen = getCurrentScreen();
    const promptDb = await getPromptDb();

    const bounds = promptWindow?.getBounds();

    const promptPath = (promptScript?.filePath || mainScriptPath).slice();
    const prevBounds =
      promptDb?.screens?.[String(currentScreen.id)]?.[promptPath];

    // Ignore if flag
    const size = b & Bounds.Size;
    const position = b & Bounds.Position;

    // console.log({
    //   currentScreen: currentScreen.id,
    //   size,
    //   position,
    //   promptScript,
    //   state: promptState,
    //   prevBounds,
    //   bounds,
    // });

    const { x, y } = position ? bounds : prevBounds || bounds;
    const { width, height } = size ? bounds : prevBounds || bounds;

    const promptBounds: PromptBounds = {
      x,
      y,
      width: width < MIN_WIDTH ? MIN_WIDTH : width,
      height: height < MIN_HEIGHT ? MIN_HEIGHT : height,
    };

    const promptCached =
      promptDb.screens[String(currentScreen.id)]?.[promptPath];
    if (promptCached) {
      promptDb.screens[String(currentScreen.id)][promptPath] = promptBounds;

      // log.info(`Cache prompt:`, {
      //   script: promptScript.filePath,
      //   screen: currentScreen.id,
      //   ...promptBounds,
      // });

      await promptDb.write();
    }
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
      if (app?.hide) app?.hide();
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
  // if (promptScript?.filePath === script?.filePath) return;
  promptScript = script;

  // if (promptScript?.id === script?.id) return;
  // log.info(script);

  if (script.filePath === mainScriptPath) {
    script.tabs = script?.tabs?.filter(
      (tab: string) => !tab.match(/join|live/i)
    );
  }

  sendToPrompt(Channel.SET_SCRIPT, script);

  instantChoices = [];
  if (script.filePath === mainScriptPath) {
    sendToPrompt(Channel.SET_PLACEHOLDER, 'Run Script');
    setChoices(getScriptsMemory());
  }
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

export const setPreview = (html: string) => {
  sendToPrompt(Channel.SET_PREVIEW, html);
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
  setIgnoreBlur(Boolean(promptData?.ignoreBlur));
  sendToPrompt(Channel.SET_PROMPT_DATA, promptData);
  showPrompt();
};

export const setChoices = (choices: Choice[]) => {
  sendToPrompt(Channel.SET_UNFILTERED_CHOICES, choices);
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

export const getPromptBounds = () => promptWindow.getBounds();

export const destroyPromptWindow = () => {
  if (promptWindow) {
    hideAppIfNoWindows();
    promptWindow.destroy();
  }
};
