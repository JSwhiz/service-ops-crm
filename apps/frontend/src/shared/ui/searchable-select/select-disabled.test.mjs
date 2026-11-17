import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const React = require('react');
const ts = require('typescript');
const source = readFileSync(new URL('./select.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const module = { exports: {} };
const fakeSelect = () => null;
vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`)(
  (name) => name === './searchable-select' ? { SearchableSelect: fakeSelect } : require(name),
  module,
  module.exports,
);
const { Select } = module.exports;

function renderedSelect(options, value, onChange = () => {}) {
  return Select({ value, onChange, children: options }).props.children.props;
}

test('disabled options cannot be selected even if the callback receives their value', () => {
  const received = [];
  const props = renderedSelect([
    React.createElement('option', { key: 'a', value: 'a' }, 'Allowed'),
    React.createElement('option', { key: 'b', value: 'b', disabled: true }, 'Unavailable'),
  ], 'a', (event) => received.push(event.target.value));
  assert.deepEqual(props.options.map((option) => option.value), ['a']);
  props.onChange('b');
  props.onChange('a');
  assert.deepEqual(received, ['a']);
});

test('an unavailable selected value keeps its label but is not selectable', () => {
  const props = renderedSelect(React.createElement(React.Fragment, null,
    React.createElement('option', { value: 'old', disabled: true }, 'Old value · unavailable'),
    React.createElement('option', { value: 'new' }, 'New value'),
  ), 'old');
  assert.equal(props.selectedOption.label, 'Old value · unavailable');
  assert.deepEqual(props.options.map((option) => option.value), ['new']);
});

test('disabled placeholder remains the placeholder while enabled empty option works', () => {
  const options = [React.createElement('option', { key: 'empty', value: '', disabled: true }, 'Choose'),
    React.createElement('option', { key: 'x', value: 'x' }, 'X')];
  const props = renderedSelect(options, '');
  assert.equal(props.placeholder, 'Choose');
  assert.deepEqual(props.options.map((option) => option.value), ['x']);
  const received = [];
  const allowed = renderedSelect(React.createElement('option', { value: '' }, 'All'), 'x', (event) => received.push(event.target.value));
  allowed.onChange('');
  assert.deepEqual(received, ['']);
});
