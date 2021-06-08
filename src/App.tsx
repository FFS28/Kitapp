/* eslint-disable react/no-danger */
/* eslint-disable react/jsx-props-no-spreading */
/* eslint-disable no-restricted-syntax */
/* eslint-disable guard-for-in */
/* eslint-disable jsx-a11y/click-events-have-key-events */
/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable react/no-array-index-key */
/* eslint-disable react/prop-types */
/* eslint-disable no-nested-ternary */
/* eslint-disable @typescript-eslint/no-shadow */
/* eslint-disable jsx-a11y/no-autofocus */
/* eslint-disable jsx-a11y/label-has-associated-control */
import React, {
  ErrorInfo,
  KeyboardEvent,
  RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useDebouncedCallback } from 'use-debounce';
import { ipcRenderer } from 'electron';
import SimpleBar from 'simplebar-react';
import { partition } from 'lodash';
import usePrevious from '@rooks/use-previous';
import useResizeObserver from '@react-hook/resize-observer';
import parse from 'html-react-parser';
import { PromptData, Script, Choice } from './types';
import Tabs from './components/tabs';
import ChoiceButton from './components/button';
import Preview from './components/preview';
import Panel from './components/panel';
import Header from './components/header';
import { Channel, Mode, InputType } from './enums';

const generateShortcut = ({
  option,
  command,
  shift,
  superKey,
  control,
}: any) => {
  return `${command ? `command ` : ``}${shift ? `shift ` : ``}${
    option ? `option ` : ``
  }${control ? `control ` : ``}${superKey ? `super ` : ``}`;
};

const keyFromCode = (code: string) => {
  const keyCode = code.replace(/Key|Digit/, '').toLowerCase();
  const replaceAlts = (k: string) => {
    const map: any = {
      backslash: '\\',
      slash: '/',
      quote: `'`,
      backquote: '`',
      equal: `=`,
      minus: `-`,
      period: `.`,
      comma: `,`,
      bracketleft: `[`,
      bracketright: `]`,
      space: 'space',
      semicolon: ';',
    };

    if (map[k]) return map[k];

    return k;
  };

  return replaceAlts(keyCode);
};
class ErrorBoundary extends React.Component {
  // eslint-disable-next-line react/state-in-constructor
  public state: { hasError: boolean } = { hasError: false };

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Display fallback UI
    this.setState({ hasError: true });
    // You can also log the error to an error reporting service
    ipcRenderer.send('PROMPT_ERROR', { error });
  }

  render() {
    // eslint-disable-next-line react/destructuring-assignment
    if (this.state.hasError) {
      // You can render any custom fallback UI
      return <h1>Something went wrong.</h1>;
    }
    // eslint-disable-next-line react/destructuring-assignment
    return this.props.children;
  }
}

const DEFAULT_MAX_HEIGHT = 480;

export default function App() {
  const [script, setScript] = useState<Script>();
  const [submitted, setSubmitted] = useState<boolean>(false);
  const [promptData, setPromptData]: any = useState({});

  const [inputValue, setInputValue] = useState<string>('');
  const [inputType, setInputType] = useState<InputType>(InputType.text);
  const [textAreaValue, setTextAreaValue] = useState('');
  const [hint, setHint] = useState('');
  // const previousHint = usePrevious(hint);
  const [mode, setMode] = useState(Mode.FILTER);
  const [index, setIndex] = useState(0);
  const [tabs, setTabs] = useState<string[]>([]);
  const [tabIndex, setTabIndex] = useState(0);
  const [unfilteredChoices, setUnfilteredChoices] = useState<Choice[]>([]);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [placeholder, setPlaceholder] = useState('');
  // const [debouncedPlaceholder] = useDebounce(placeholder, 10);
  const previousPlaceholder: string | null = usePrevious(placeholder);
  const [dropReady, setDropReady] = useState(false);
  const [panelHTML, setPanelHTML] = useState('');
  // const [scriptName, setScriptName] = useState('');
  const [maxHeight, setMaxHeight] = useState(DEFAULT_MAX_HEIGHT);

  const [caretDisabled, setCaretDisabled] = useState(false);
  const choicesSimpleBarRef = useRef(null);
  const choicesRef = useRef(null);
  const panelRef = useRef(null);
  const inputRef: RefObject<HTMLInputElement> = useRef(null);
  const textAreaRef: RefObject<HTMLTextAreaElement> = useRef(null);
  const windowContainerRef: RefObject<HTMLDivElement> = useRef(null);
  const topRef: RefObject<HTMLDivElement> = useRef(null);
  const [isMouseDown, setIsMouseDown] = useState(false);
  const [hotkey, setHotkey] = useState({});
  const [mouseEnabled, setMouseEnabled] = useState(false);

  const sendResize = useDebouncedCallback(
    useCallback(
      (width: number, height: number) => {
        if (isMouseDown) return;
        const { height: topHeight } =
          topRef?.current?.getBoundingClientRect() as any;

        if (!choicesRef.current) (choicesRef?.current as any)?.recalculate();
        if (!panelRef.current) (panelRef?.current as any)?.recalculate();

        const hasContent =
          unfilteredChoices?.length ||
          panelHTML?.length ||
          textAreaRef?.current;
        const promptHeight =
          height > topHeight && hasContent ? height : topHeight;

        ipcRenderer.send(Channel.CONTENT_SIZE_UPDATED, {
          width: Math.round(width),
          height: Math.round(promptHeight),
        });
      },
      [unfilteredChoices?.length, isMouseDown, panelHTML?.length]
    ),
    10
  );

  useResizeObserver(windowContainerRef, (entry) => {
    const { width, height } = entry.contentRect;
    sendResize(width, height);
  });

  // useEffect(() => {
  //   if (inputRef.current) {
  //     inputRef?.current.focus();
  //   }
  // }, [inputRef]);

  const submit = useCallback(
    (submitValue: any) => {
      let value = submitValue;
      if (mode !== Mode.HOTKEY) {
        setPlaceholder(
          typeof submitValue === 'string' && !promptData?.secret
            ? submitValue
            : 'Processing...'
        );
      }

      // setUnfilteredChoices([]);
      // setPanelHTML('');

      if (Array.isArray(submitValue)) {
        const files = submitValue.map((file) => {
          const fileObject: any = {};

          for (const key in file) {
            const value = file[key];
            const notFunction = typeof value !== 'function';
            if (notFunction) fileObject[key] = value;
          }

          return fileObject;
        });

        value = files;
      }

      ipcRenderer.send(Channel.VALUE_SUBMITTED, {
        value,
        pid: promptData?.pid,
      });

      setSubmitted(true);
      setInputValue('');
      setTextAreaValue('');
      setHint('');
    },
    [mode, promptData?.pid, promptData?.secret]
  );

  useEffect(() => {
    if (index > choices?.length - 1) setIndex(choices?.length - 1);
    if (choices?.length && index <= 0) setIndex(0);
  }, [choices?.length, index]);

  const onChange = useCallback((value) => {
    setIndex(0);
    if (typeof value === 'string') {
      setInputValue(value);
    }
  }, []);

  const onDragEnter = useCallback((event) => {
    event.preventDefault();
    setDropReady(true);
    setPlaceholder('Drop to submit');
  }, []);
  const onDragLeave = useCallback((event) => {
    setDropReady(false);
    setPlaceholder(previousPlaceholder || '');
  }, []);
  const onDrop = useCallback(
    (event) => {
      setDropReady(false);
      const files = Array.from(event?.dataTransfer?.files);
      if (files?.length > 0) {
        submit(files);
        return;
      }

      const data =
        event?.dataTransfer?.getData('URL') ||
        event?.dataTransfer?.getData('Text') ||
        null;
      if (data) {
        submit(data);
        return;
      }
      if (event.target.value) {
        submit(event.target.value);
        return;
      }

      setTimeout(() => {
        submit(event.target.value);
      }, 100);
    },
    [submit]
  );

  // useEffect(() => {
  //   if (choices?.length > 0 && choices?.[index]) {
  //     ipcRenderer.send(CHOICE_FOCUSED, {
  //       index,
  //       pid: promptData?.pid,
  //     });
  //   }
  //   if (choices?.length === 0) {
  //     ipcRenderer.send(CHOICE_FOCUSED, { index: null, pid: promptData?.pid });
  //   }
  // }, [choices, index, promptData?.pid]);

  const onTabClick = useCallback(
    (ti: number) => (_event: any) => {
      setTabIndex(ti);

      ipcRenderer.send(Channel.TAB_CHANGED, {
        tab: tabs[ti],
        input: inputValue,
        pid: promptData?.pid,
      });
    },
    [inputValue, promptData?.pid, tabs]
  );

  const closePrompt = useCallback(() => {
    ipcRenderer.send(Channel.ESCAPE_PRESSED, { pid: promptData?.pid });
    setChoices([]);
    setTabIndex(0);
    setUnfilteredChoices([]);
    setInputValue('');
    setPanelHTML('');
    setPromptData({});
    setHint('');
  }, [promptData]);

  const onKeyUp = useCallback(
    (event) => {
      if (event.key === 'Escape') {
        closePrompt();
        return;
      }

      if (mode === Mode.HOTKEY) {
        event.preventDefault();
        const {
          code,
          metaKey: command,
          shiftKey: shift,
          ctrlKey: control,
          altKey: option,
        } = event as any;
        const superKey = event.getModifierState('Super');
        const shortcut = generateShortcut({
          code,
          command,
          shift,
          control,
          option,
          superKey,
        });
        setPlaceholder(shortcut);
      }
    },
    [closePrompt, mode]
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') {
        return;
      }

      if (mode === Mode.HOTKEY) {
        const {
          key,
          code,
          metaKey: command,
          shiftKey: shift,
          ctrlKey: control,
          altKey: option,
        } = event as any;
        const superKey = event.getModifierState('Super');
        const shortcut = generateShortcut({
          command,
          shift,
          control,
          option,
          superKey,
        });

        const normalKey = option ? keyFromCode(code) : key;

        const eventKeyData = {
          key: normalKey,
          command,
          shift,
          option,
          control,
          fn: event.getModifierState('Fn'),
          // fnLock: event.getModifierState('FnLock'),
          // numLock: event.getModifierState('NumLock'),
          hyper: event.getModifierState('Hyper'),
          os: event.getModifierState('OS'),
          super: superKey,
          win: event.getModifierState('Win'),
          // scrollLock: event.getModifierState('ScrollLock'),
          // scroll: event.getModifierState('Scroll'),
          // capsLock: event.getModifierState('CapsLock'),
          shortcut: `${shortcut}${normalKey}`,
        };

        setHotkey(eventKeyData);
        setPlaceholder(shortcut);

        if (
          event.key.length === 1 ||
          ['Shift', 'Control', 'Alt', 'Meta'].every(
            (m) => !event.key.includes(m)
          )
        ) {
          submit(eventKeyData);
        }
        event.preventDefault();
        return;
      }

      if (event.key === 'Enter') {
        submit(choices?.[index]?.value || inputValue);
        return;
      }

      if (event.key === ' ') {
        const tab = tabs.find((tab) =>
          tab.toLowerCase().startsWith(inputValue.toLowerCase())
        );

        if (tab) {
          const ti = tabs.indexOf(tab);
          setTabIndex(ti);
          setInputValue('');
          ipcRenderer.send(Channel.TAB_CHANGED, {
            tab,
            input: inputValue,
            pid: promptData?.pid,
          });
          event.preventDefault();
          return;
        }

        const shortcodeChoice = unfilteredChoices?.find(
          (choice) => choice?.shortcode === inputValue.trim()
        );
        if (shortcodeChoice) {
          submit(shortcodeChoice.value);
          event.preventDefault();
          return;
        }
      }

      if (event.key === 'Tab') {
        event.preventDefault();
        if (tabs?.length) {
          const clamp = tabs.length;
          const clampIndex = (tabIndex + (event.shiftKey ? -1 : 1)) % clamp;
          const nextIndex = clampIndex < 0 ? clamp - 1 : clampIndex;
          setTabIndex(nextIndex);
          ipcRenderer.send(Channel.TAB_CHANGED, {
            tab: tabs[nextIndex],
            input: inputValue,
            pid: promptData?.pid,
          });
        }
        return;
      }

      // if (tabs?.length) {
      //   tabs.forEach((_tab, i) => {
      //     // cmd+2, etc.
      //     if (event.metaKey && event.key === `${i + 1}`) {
      //       event.preventDefault();
      //       setTabIndex(i);
      //       ipcRenderer.send(TAB_CHANGED, {
      //         tab: tabs[i],
      //         input: inputValue,
      //       });
      //     }
      //   });
      // }

      let newIndex = index;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        newIndex += 1;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        newIndex -= 1;
      }

      if (newIndex < 0) newIndex = 0;
      if (newIndex > choices?.length - 1) newIndex = choices?.length - 1;

      setIndex(newIndex);

      if (choicesSimpleBarRef.current) {
        const el = choicesSimpleBarRef.current;
        const selectedItem: any = el.firstElementChild?.children[newIndex];
        const itemY = selectedItem?.offsetTop;
        const marginBottom = parseInt(
          getComputedStyle(selectedItem as any)?.marginBottom.replace('px', ''),
          10
        );
        if (
          itemY >=
          el.scrollTop + el.clientHeight - selectedItem.clientHeight
        ) {
          selectedItem?.scrollIntoView({ block: 'end', inline: 'nearest' });
          el.scrollTo({
            top: el.scrollTop + marginBottom,
          });
        } else if (itemY < el.scrollTop) {
          selectedItem?.scrollIntoView({ block: 'start', inline: 'nearest' });
        }
      }
    },
    [
      mode,
      index,
      choices,
      submit,
      inputValue,
      unfilteredChoices,
      tabs,
      tabIndex,
      promptData?.pid,
    ]
  );
  const onTextAreaKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      const { key, metaKey: command } = event as any;

      if (key === 'Escape') {
        event.preventDefault();
        closePrompt();
        return;
      }
      if (key === 'Enter' && command) {
        event.preventDefault();
        submit(textAreaValue);
      }
    },
    [textAreaValue]
  );

  const generateChoices = useDebouncedCallback((input, mode, tab) => {
    if (mode === Mode.GENERATE) {
      ipcRenderer.send(Channel.GENERATE_CHOICES, {
        input,
        pid: promptData?.pid,
      });
    }
  }, 150);

  useEffect(() => {
    if (!submitted) generateChoices(inputValue, mode, tabIndex);
  }, [mode, inputValue, tabIndex, submitted]);

  useEffect(() => {
    setCaretDisabled(Boolean(!promptData?.placeholder));
  }, [promptData?.placeholder]);

  useEffect(() => {
    try {
      if (mode === (Mode.GENERATE || Mode.MANUAL)) {
        setChoices(unfilteredChoices);
        return;
      }
      if (!unfilteredChoices?.length) {
        setChoices([]);
        return;
      }

      if (submitted) return;

      const input = inputValue?.toLowerCase() || '';

      const startExactFilter = (choice: any) =>
        choice.name?.toLowerCase().startsWith(input);

      const startEachWordFilter = (choice: any) => {
        let wordIndex = 0;
        let wordLetterIndex = 0;
        const words = choice.name?.toLowerCase().match(/\w+\W*/g);
        if (!words) return false;
        const inputLetters: string[] = input.split('');

        const checkNextLetter = (inputLetter: string): boolean => {
          const word = words[wordIndex];
          const letter = word[wordLetterIndex];

          if (inputLetter === letter) {
            wordLetterIndex += 1;
            return true;
          }

          return false;
        };

        const checkNextWord = (inputLetter: string): boolean => {
          wordLetterIndex = 0;
          wordIndex += 1;

          const word = words[wordIndex];
          if (!word) return false;
          const letter = word[wordLetterIndex];
          if (!letter) return false;

          if (inputLetter === letter) {
            wordLetterIndex += 1;
            return true;
          }

          return checkNextWord(inputLetter);
        };
        return inputLetters.every((inputLetter: string) => {
          if (checkNextLetter(inputLetter)) {
            return true;
          }
          return checkNextWord(inputLetter);
        });
      };

      const startFirstAndEachWordFilter = (choice: any) => {
        return (
          choice.name?.toLowerCase().startsWith(input[0]) &&
          startEachWordFilter(choice)
        );
      };

      const partialFilter = (choice: any) =>
        choice.name?.toLowerCase().includes(input);

      const [startExactMatches, notBestMatches] = partition(
        unfilteredChoices,
        startExactFilter
      );

      const [startAndFirstMatches, notStartMatches] = partition(
        notBestMatches,
        startFirstAndEachWordFilter
      );

      const [startMatches, notStartAndFirstMatches] = partition(
        notStartMatches,
        startEachWordFilter
      );
      const [partialMatches, notMatches] = partition(
        notStartAndFirstMatches,
        partialFilter
      );

      const filtered = [
        ...startExactMatches,
        ...startAndFirstMatches,
        ...startMatches,
        ...partialMatches,
      ];

      setChoices(filtered);
      const { width, height } =
        windowContainerRef?.current?.getBoundingClientRect() as DOMRect;
      // sendResize(width, height);
    } catch (error) {
      ipcRenderer.send('PROMPT_ERROR', { error, pid: promptData?.id });
    }
  }, [
    unfilteredChoices,
    inputValue,
    mode,
    promptData?.id,
    sendResize,
    submitted,
  ]);

  const setPromptDataHandler = useCallback(
    (_event: any, promptData: PromptData) => {
      setPanelHTML('');
      setPromptData(promptData);
      setPlaceholder(promptData.placeholder);

      setTabs(promptData?.tabs || []);

      if (inputRef.current) {
        inputRef?.current.focus();
      }

      if (textAreaRef.current) {
        textAreaRef?.current.focus();
      }
    },
    []
  );

  const setTabIndexHandler = useCallback((_event: any, ti: number) => {
    setSubmitted(false);

    setPanelHTML('');
    setTabIndex(ti);
  }, []);

  const setPlaceholderHandler = useCallback((_event: any, text: string) => {
    setPlaceholder(text);
  }, []);

  const setPanelHandler = useCallback((_event: any, html: string) => {
    setChoices([]);
    setUnfilteredChoices([]);

    setPanelHTML(html);
  }, []);

  const setModeHandler = useCallback((_event: any, mode: Mode) => {
    setMode(mode);
  }, []);

  const setHintHandler = useCallback((_event: any, hint: string) => {
    setHint(hint);
  }, []);

  const setInputHandler = useCallback((_event: any, input: string) => {
    setSubmitted(false);

    setInputValue(input);
  }, []);

  const setChoicesHandler = useCallback((_event: any, choices: Choice[]) => {
    setSubmitted(false);
    setIndex(0);
    setPanelHTML('');
    setUnfilteredChoices(choices);
  }, []);

  const resetPromptHandler = useCallback(() => {
    setIsMouseDown(false);
    setMouseEnabled(false);
    setPlaceholder('');
    setDropReady(false);
    setChoices([]);
    setHint('');
    setInputValue('');
    setPanelHTML('');
    setPromptData({});
    setTabs([]);
    setUnfilteredChoices([]);
  }, []);

  const setScriptHandler = useCallback((_event, script: Script) => {
    // resetPromptHandler();
    setSubmitted(false);
    setScript(script);
    setInputType(script.input);
    setPlaceholder(script.placeholder);
    setTabs(script.tabs || []);
    setTabIndex(0);
  }, []);

  const userResizedHandler = useCallback((event, data) => {
    setIsMouseDown(!!data);
    setMaxHeight(window.innerHeight);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const messageMap = {
    // [Channel.RESET_PROMPT]: resetPromptHandler,
    [Channel.SET_SCRIPT]: setScriptHandler,
    [Channel.SET_CHOICES]: setChoicesHandler,
    [Channel.SET_HINT]: setHintHandler,
    [Channel.SET_INPUT]: setInputHandler,
    [Channel.SET_MODE]: setModeHandler,
    [Channel.SET_PANEL]: setPanelHandler,
    [Channel.SET_PLACEHOLDER]: setPlaceholderHandler,
    [Channel.SET_TAB_INDEX]: setTabIndexHandler,
    [Channel.SET_PROMPT_DATA]: setPromptDataHandler,
    [Channel.USER_RESIZED]: userResizedHandler,
  };

  useEffect(() => {
    Object.entries(messageMap).forEach(([key, value]: any) => {
      if (ipcRenderer.listenerCount(key) === 0) {
        ipcRenderer.on(key, (event, data) => {
          // if (data?.kitScript) setScriptName(data?.kitScript);
          value(event, data);
        });
      }
    });

    return () => {
      Object.entries(messageMap).forEach(([key, value]: any) => {
        ipcRenderer.off(key, value);
      });
    };
  }, [messageMap]);

  return (
    <ErrorBoundary>
      <div
        ref={windowContainerRef}
        style={
          {
            WebkitAppRegion: 'drag',
            WebkitUserSelect: 'none',
            maxHeight,
          } as any
        }
        className="flex flex-col w-full rounded-lg relative h-full"
      >
        <div ref={topRef}>
          {(script?.description || script?.twitter || script?.menu) && (
            <Header script={script} />
          )}
          {inputType === InputType.text && (
            <input
              style={
                {
                  WebkitAppRegion: 'drag',
                  WebkitUserSelect: 'none',
                  minHeight: '4rem',
                  ...(caretDisabled && { caretColor: 'transparent' }),
                } as any
              }
              autoFocus
              className={`bg-transparent w-full text-black dark:text-white focus:outline-none outline-none text-xl dark:placeholder-white dark:placeholder-opacity-40 placeholder-black placeholder-opacity-40 h-16
            ring-0 ring-opacity-0 focus:ring-0 focus:ring-opacity-0 pl-4 py-0

            ${
              promptData?.drop
                ? `
            border-dashed border-4 rounded border-gray-500 focus:border-gray-500 text-opacity-50 ${
              dropReady &&
              `border-yellow-500 text-opacity-90 focus:border-yellow-500`
            }`
                : `            focus:border-none border-none`
            }
          `}
              onChange={
                mode !== Mode.HOTKEY
                  ? (e) => {
                      onChange(e.target.value);
                    }
                  : undefined
              }
              onKeyDown={onKeyDown}
              onKeyUp={onKeyUp}
              placeholder={placeholder}
              ref={inputRef}
              type={promptData?.secret ? 'password' : 'text'}
              value={mode !== Mode.HOTKEY ? inputValue : undefined}
              onDragEnter={promptData?.drop ? onDragEnter : undefined}
              onDragLeave={promptData?.drop ? onDragLeave : undefined}
              onDrop={promptData?.drop ? onDrop : undefined}
            />
          )}
          {hint && (
            <div className="pl-3 pb-1 text-xs text-gray-800 dark:text-gray-200 italic">
              {parse(hint)}
            </div>
          )}
          {tabs?.length > 0 && (
            <Tabs tabs={tabs} tabIndex={tabIndex} onTabClick={onTabClick} />
          )}
        </div>
        {inputType === InputType.textarea && (
          <textarea
            ref={textAreaRef}
            style={
              {
                WebkitAppRegion: 'no-drag',
                WebkitUserSelect: 'text',
                height: maxHeight,
              } as any
            }
            onKeyDown={onTextAreaKeyDown}
            onChange={(e) => {
              setTextAreaValue(e.target.value);
            }}
            value={textAreaValue}
            placeholder={placeholder}
            className={`
            min-h-32

              bg-transparent w-full text-black dark:text-white focus:outline-none outline-none text-md dark:placeholder-white dark:placeholder-opacity-40 placeholder-black placeholder-opacity-40
              ring-0 ring-opacity-0 focus:ring-0 focus:ring-opacity-0 pl-4 py-4
              focus:border-none border-none
              `}
          />
        )}
        {panelHTML?.length > 0 && (
          <Panel ref={panelRef} panelHTML={panelHTML} />
        )}

        {choices?.length > 0 && (
          <div
            className="flex flex-row w-full max-h-full overflow-y-hidden border-t dark:border-white dark:border-opacity-5 border-black border-opacity-5 min-w-1/2"
            style={
              {
                WebkitAppRegion: 'no-drag',
                WebkitUserSelect: 'none',
              } as any
            }
          >
            <SimpleBar
              ref={choicesRef}
              scrollableNodeProps={{ ref: choicesSimpleBarRef }}
              onMouseEnter={() => setMouseEnabled(true)}
              className="px-0 flex flex-col text-black dark:text-white max-h-full overflow-y-scroll focus:border-none focus:outline-none outline-none flex-1 bg-opacity-20 min-w-1/2"
            >
              {((choices as any[]) || []).map((choice, i) => (
                <ChoiceButton
                  key={choice.id}
                  choice={choice}
                  i={i}
                  submit={submit}
                  mode={mode}
                  index={index}
                  inputValue={inputValue}
                  setIndex={setIndex}
                  mouseEnabled={mouseEnabled}
                />
              ))}
            </SimpleBar>
            {choices?.[index]?.preview && (
              <Preview preview={choices?.[index]?.preview || ''} />
            )}
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}
