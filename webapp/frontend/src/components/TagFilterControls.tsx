import React from 'react';
import { ButtonGroup, Button, Dropdown } from 'react-bootstrap';

const filterModeLabels: { [key: string]: string } = {
  'include-and': '태그 포함 (모두)',
  'include-or': '태그 포함 (일부)',
  'exclude': '태그 제외'
};

export const evaluateAdvancedRule = (rule: string, tags: string[]): boolean => {
  if (!rule.trim()) return true;
  const tokens = rule.match(/\(|\)|\bAND\b|\bOR\b|\bNOT\b|[^\s()]+/gi) || [];
  const outputQueue: string[] = [];
  const operatorStack: string[] = [];
  const precedence: { [key: string]: number } = { 'OR': 1, 'AND': 2, 'NOT': 3 };
  const associativity: { [key: string]: string | undefined } = { 'NOT': 'Right' };
  for (const token of tokens) {
    const upperToken = token.toUpperCase();
    if (upperToken === 'AND' || upperToken === 'OR' || upperToken === 'NOT') {
      while (
        operatorStack.length > 0 &&
        operatorStack[operatorStack.length - 1] !== '(' &&
        (precedence[operatorStack[operatorStack.length - 1].toUpperCase()] > precedence[upperToken] ||
         (precedence[operatorStack[operatorStack.length - 1].toUpperCase()] === precedence[upperToken] && associativity[upperToken] !== 'Right'))
      ) {
        outputQueue.push(operatorStack.pop()!);
      }
      operatorStack.push(token);
    } else if (token === '(') {
      operatorStack.push(token);
    } else if (token === ')') {
      while (operatorStack.length > 0 && operatorStack[operatorStack.length - 1] !== '(') {
        outputQueue.push(operatorStack.pop()!);
      }
      if (operatorStack.length === 0) throw new Error("Mismatched parentheses");
      operatorStack.pop();
    } else {
      outputQueue.push(token);
    }
  }
  while (operatorStack.length > 0) {
    if (operatorStack[operatorStack.length - 1] === '(') throw new Error("Mismatched parentheses");
    outputQueue.push(operatorStack.pop()!);
  }
  const evalStack: boolean[] = [];
  for (const token of outputQueue) {
    const upperToken = token.toUpperCase();
    if (upperToken === 'AND') {
      const b = evalStack.pop();
      const a = evalStack.pop();
      if (a === undefined || b === undefined) throw new Error("Invalid syntax");
      evalStack.push(a && b);
    } else if (upperToken === 'OR') {
      const b = evalStack.pop();
      const a = evalStack.pop();
      if (a === undefined || b === undefined) throw new Error("Invalid syntax");
      evalStack.push(a || b);
    } else if (upperToken === 'NOT') {
      const a = evalStack.pop();
      if (a === undefined) throw new Error("Invalid syntax");
      evalStack.push(!a);
    } else {
      evalStack.push(tags.some(t => t.toLowerCase() === token.toLowerCase()));
    }
  }
  if (evalStack.length !== 1) throw new Error("Invalid syntax");
  return evalStack[0];
};

interface TagFilterControlsProps {
  isAdvancedMode: boolean;
  setIsAdvancedMode: (isAdvanced: boolean) => void;
  filterMode: 'include-or' | 'include-and' | 'exclude';
  setFilterMode: (mode: 'include-or' | 'include-and' | 'exclude') => void;
}

export const TagFilterControls: React.FC<TagFilterControlsProps> = ({
  isAdvancedMode, setIsAdvancedMode, filterMode, setFilterMode
}) => {

  return (
    <div className="d-flex flex-wrap align-items-center justify-content-between mb-2">
      <div className="d-flex align-items-center gap-2">
        <span className="fw-bold">태그 선택</span>
        <ButtonGroup size="sm">
          <Button variant={!isAdvancedMode ? 'primary' : 'outline-secondary'} onClick={() => setIsAdvancedMode(false)} className="fw-bold">기본</Button>
          <Button variant={isAdvancedMode ? 'primary' : 'outline-secondary'} onClick={() => setIsAdvancedMode(true)} className="fw-bold">고급</Button>
        </ButtonGroup>
      </div>
      {!isAdvancedMode && (
        <div className="d-flex align-items-center gap-2">
          <div style={{ minWidth: '130px' }}>
            <Dropdown onSelect={(mode) => setFilterMode(mode as any)}>
              <Dropdown.Toggle variant="outline-secondary" id="dropdown-filter-mode" size="sm" className="w-100 d-flex justify-content-between align-items-center">
                <span>{filterModeLabels[filterMode]}</span>
              </Dropdown.Toggle>
              <Dropdown.Menu className="w-100">
                <Dropdown.Item eventKey="include-and">{filterModeLabels['include-and']}</Dropdown.Item>
                <Dropdown.Item eventKey="include-or">{filterModeLabels['include-or']}</Dropdown.Item>
                <Dropdown.Item eventKey="exclude">{filterModeLabels['exclude']}</Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown>
          </div>
        </div>
      )}
    </div>
  );
};