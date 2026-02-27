import { useCallback, useRef, useState } from 'react';
import { MacroStep } from '../types/macroTypes';

export interface UseMacroRecorderResult {
  isRecording: boolean;
  steps: MacroStep[];
  currentCommand: string;
  startRecording: () => void;
  recordInput: (data: string) => void;
  stopRecording: () => MacroStep[];
}

export function useMacroRecorder(): UseMacroRecorderResult {
  const [isRecording, setIsRecording] = useState(false);
  const [steps, setSteps] = useState<MacroStep[]>([]);
  const [currentCommand, setCurrentCommand] = useState('');

  const commandBuf = useRef('');
  const stepsRef = useRef<MacroStep[]>([]);
  const lastStepTime = useRef<number>(0);

  const startRecording = useCallback(() => {
    commandBuf.current = '';
    stepsRef.current = [];
    lastStepTime.current = Date.now();
    setSteps([]);
    setCurrentCommand('');
    setIsRecording(true);
  }, []);

  const recordInput = useCallback((data: string) => {
    // Check for Enter / Return
    if (data === '\r' || data === '\n' || data === '\r\n') {
      const now = Date.now();
      const delayMs = stepsRef.current.length === 0 ? 0 : now - lastStepTime.current;
      const step: MacroStep = {
        command: commandBuf.current,
        delayMs,
        sendNewline: true,
      };
      stepsRef.current.push(step);
      lastStepTime.current = now;
      commandBuf.current = '';
      setSteps([...stepsRef.current]);
      setCurrentCommand('');
    } else if (data === '\x7f' || data === '\b') {
      // Backspace
      commandBuf.current = commandBuf.current.slice(0, -1);
      setCurrentCommand(commandBuf.current);
    } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
      // Printable character
      commandBuf.current += data;
      setCurrentCommand(commandBuf.current);
    } else if (data.length > 1 && !data.startsWith('\x1b')) {
      // Pasted text (multi-char, not escape sequence)
      commandBuf.current += data;
      setCurrentCommand(commandBuf.current);
    }
    // Ignore escape sequences (arrow keys, etc.)
  }, []);

  const stopRecording = useCallback((): MacroStep[] => {
    // If there's remaining text in the buffer, add it as a final step without newline
    if (commandBuf.current.length > 0) {
      const now = Date.now();
      const delayMs = stepsRef.current.length === 0 ? 0 : now - lastStepTime.current;
      stepsRef.current.push({
        command: commandBuf.current,
        delayMs,
        sendNewline: false,
      });
    }
    const finalSteps = [...stepsRef.current];
    setIsRecording(false);
    setSteps(finalSteps);
    setCurrentCommand('');
    commandBuf.current = '';
    return finalSteps;
  }, []);

  return { isRecording, steps, currentCommand, startRecording, recordInput, stopRecording };
}
