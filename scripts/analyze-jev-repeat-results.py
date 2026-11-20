"""Post-run repeat diagnostics; preserves the frozen benchmark and original result.
Note: see .agents/notes/knowledge/requirements/unified-memory-laya-primary.md
"""
import argparse
import importlib.util
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('benchmark',ROOT/'scripts/benchmark-knowledge-reviewers.py')
benchmark=importlib.util.module_from_spec(spec)
spec.loader.exec_module(benchmark)


def analyze(source, standard):
    expected=benchmark.cases(standard)
    rows=source['results']
    if len(rows)!=len(expected): raise ValueError('Incomplete result set')
    for row,case in zip(rows,expected):
        if any(row.get(key)!=value for key,value in case.items()):
            raise ValueError('Case identity or labels changed')
        scores=row['repeatProbabilities']
        if len(scores)!=standard['repetitions']: raise ValueError('Missing repeat')
        for score in scores:
            if score is None: raise ValueError('Missing probability')
            benchmark.decision(score,standard['threshold'])
    by_repeat=[]
    categories={r['id']:r.get('category',r.get('group','uncategorized')) for r in expected}
    for page in standard['wikiPages']:
        for i in range(len(page['claims'])):
            categories[page['id']+':'+str(i)]=page.get('category',page.get('group','uncategorized'))
    for index in range(standard['repetitions']):
        projected=[{**r,'pSupport':r['repeatProbabilities'][index],
                    'decision':benchmark.decision(r['repeatProbabilities'][index],standard['threshold'])} for r in rows]
        by_repeat.append({'repeat':index+1,
                          'development':benchmark.metrics([r for r in projected if r['split']=='development']),
                          'validation':benchmark.metrics([r for r in projected if r['split']=='validation']),
                          'validationByCategory':{category:benchmark.metrics([r for r in projected if r['split']=='validation' and categories[r['id']]==category]) for category in sorted({categories[r['id']] for r in projected if r['split']=='validation'})},
                          'wikiPages':benchmark.page_metrics(projected)})
    stability={}
    for split in ['development','validation']:
        selected=[r for r in rows if r['split']==split]
        numeric=[r['id'] for r in selected if max(r['repeatProbabilities'])-min(r['repeatProbabilities'])>1e-5]
        label=[r['id'] for r in selected if len({p>=.5 for p in r['repeatProbabilities']})>1]
        actions=[r['id'] for r in selected if len({benchmark.decision(p,standard['threshold']) for p in r['repeatProbabilities']})>1]
        stability[split]={'cases':len(selected),'numericVariationIds':numeric,'classificationFlipIds':label,
                          'actionFlipIds':actions,'maxProbabilityRange':max(max(r['repeatProbabilities'])-min(r['repeatProbabilities']) for r in selected)}
    return {'kind':'post-run-repeat-diagnostics','qualityGate':'not-evaluated-synthetic',
            'originalStrictSummary':source['summary'],'byRepeat':by_repeat,'stability':stability,
            'reportingPlan':standard.get('reportingPlan','Post-hoc diagnostics for the original benchmark.'),
            'limits':['Repeat diagnostics do not replace the original strict acceptance policy.',
                      'All repetitions reported separately, no favorable repeat or new threshold selected.',
                      'Original 1e-5 stability results retained; no API calls or new evaluation samples.',
                      'Synthetic correlated samples cannot certify production accuracy.']}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--input',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--standard',type=Path,default=benchmark.STANDARD)
    args=parser.parse_args()
    source=json.loads(args.input.read_text(encoding='utf-8'))
    standard=json.loads(args.standard.read_text(encoding='utf-8'))
    if source['standardSha256']!=benchmark.sha(args.standard): raise ValueError('Standard changed')
    if source['developmentSha256']!=benchmark.sha(ROOT/standard['developmentDataset']): raise ValueError('Development set changed')
    result=analyze(source,standard)
    result.update({'sourceSha256':benchmark.sha(args.input),'standardSha256':source['standardSha256'],
                   'analysisScriptSha256':benchmark.sha(Path(__file__))})
    benchmark.write_json(args.output,result)
    print(json.dumps({'stability':result['stability'],'validationByRepeat':[r['validation'] for r in result['byRepeat']]},indent=2))


if __name__=='__main__': main()
