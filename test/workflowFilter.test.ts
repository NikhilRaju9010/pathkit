import { filterWorkflows } from '../src/workflowFilter';
import { DiscoveredWorkflow } from '../src/discovery';

const wf = (filePath: string, functionName: string): DiscoveredWorkflow => ({ filePath, functionName });

const discovered: DiscoveredWorkflow[] = [
  wf('src/a/orderWorkflow.ts', 'orderWorkflow'),
  wf('src/a/orderWorkflow.ts', 'cancelOrderWorkflow'),
  wf('src/b/paymentWorkflow.ts', 'paymentWorkflow'),
  wf('src/c/shippingWorkflow.ts', 'shippingWorkflow'),
];

describe('filterWorkflows', () => {
  it('is the identity when neither include nor exclude is given', () => {
    const result = filterWorkflows(discovered);
    expect(result.filtered).toEqual(discovered);
    expect(result.unmatched).toEqual([]);
  });

  it('is the identity for empty include/exclude lists', () => {
    const result = filterWorkflows(discovered, [], []);
    expect(result.filtered).toEqual(discovered);
    expect(result.unmatched).toEqual([]);
  });

  it('keeps only included basenames, including every function in a matched file', () => {
    const result = filterWorkflows(discovered, ['orderWorkflow.ts']);
    expect(result.filtered).toEqual([
      wf('src/a/orderWorkflow.ts', 'orderWorkflow'),
      wf('src/a/orderWorkflow.ts', 'cancelOrderWorkflow'),
    ]);
    expect(result.unmatched).toEqual([]);
  });

  it('removes excluded basenames', () => {
    const result = filterWorkflows(discovered, undefined, ['paymentWorkflow.ts']);
    expect(result.filtered.map((w) => w.functionName)).toEqual([
      'orderWorkflow',
      'cancelOrderWorkflow',
      'shippingWorkflow',
    ]);
  });

  it('applies include first, then exclude', () => {
    const result = filterWorkflows(discovered, ['orderWorkflow.ts', 'paymentWorkflow.ts'], ['paymentWorkflow.ts']);
    expect(result.filtered.map((w) => w.filePath)).toEqual(['src/a/orderWorkflow.ts', 'src/a/orderWorkflow.ts']);
    expect(result.unmatched).toEqual([]);
  });

  it('reports an include entry that matches nothing', () => {
    const result = filterWorkflows(discovered, ['orderWorkflow.ts', 'ghost.ts']);
    expect(result.filtered).toHaveLength(2);
    expect(result.unmatched).toEqual(['ghost.ts']);
  });

  it('reports an exclude entry that matches nothing', () => {
    const result = filterWorkflows(discovered, undefined, ['ghost.ts']);
    expect(result.filtered).toEqual(discovered);
    expect(result.unmatched).toEqual(['ghost.ts']);
  });

  it('does not report an exclude entry as unmatched just because include already dropped that file', () => {
    const result = filterWorkflows(discovered, ['orderWorkflow.ts'], ['paymentWorkflow.ts']);
    expect(result.unmatched).toEqual([]);
  });

  it('matches basename only — not a full path, a partial name, or an exported function name', () => {
    const result = filterWorkflows(discovered, ['src/a/orderWorkflow.ts', 'order', 'orderWorkflow']);
    expect(result.filtered).toEqual([]);
    expect(result.unmatched).toEqual(['src/a/orderWorkflow.ts', 'order', 'orderWorkflow']);
  });

  it('is case-sensitive', () => {
    const result = filterWorkflows(discovered, ['OrderWorkflow.ts']);
    expect(result.filtered).toEqual([]);
    expect(result.unmatched).toEqual(['OrderWorkflow.ts']);
  });

  it('does not treat glob characters specially', () => {
    const result = filterWorkflows(discovered, ['*.ts']);
    expect(result.filtered).toEqual([]);
    expect(result.unmatched).toEqual(['*.ts']);
  });

  it('matches same-named files in different directories and preserves input order', () => {
    const input = [wf('x/dup.ts', 'one'), wf('y/other.ts', 'two'), wf('z/dup.ts', 'three')];
    const result = filterWorkflows(input, ['dup.ts']);
    expect(result.filtered).toEqual([wf('x/dup.ts', 'one'), wf('z/dup.ts', 'three')]);
  });

  it('does not mutate its input', () => {
    const copy = [...discovered];
    filterWorkflows(discovered, ['orderWorkflow.ts'], ['orderWorkflow.ts']);
    expect(discovered).toEqual(copy);
  });
});
