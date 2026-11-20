"""TypeSafe Jev adapter for the frozen local evidence benchmark; dry-run by default.
Note: see .agents/notes/knowledge/requirements/unified-memory-laya-primary.md
"""
import argparse
import json
import math
import os
from pathlib import Path
import statistics
import time
import urllib.error
import urllib.request

import importlib.util

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('review_benchmark', ROOT/'scripts/benchmark-knowledge-reviewers.py')
benchmark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(benchmark)
ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
MODEL = 'jev-1.13.0'
PRICE_PER_MILLION = .042  # Public list price checked 2026-09-30; estimate, not invoice.


class ProbeError(Exception):
    """Only fixed, non-sensitive codes may cross the HTTP/credential boundary."""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ProbeError('redirect-refused')


def payload(row, standard):
    state = json.dumps({'candidate':row['claim'], 'evidence':[row['evidence']], 'existing_facts':[]},ensure_ascii=False)
    return {'model':MODEL, 'state':state,
            'questions':{'support':{'type':'noul','instructions':standard['layaQuestion']}}}


def parse_response(data):
    if not isinstance(data,dict) or data.get('model') != MODEL:
        raise ProbeError('unexpected-model')
    answers=data.get('answers')
    if not isinstance(answers,dict) or set(answers)!={'support'}:
        raise ProbeError('invalid-answers')
    answer=answers['support']
    if not isinstance(answer,dict) or answer.get('type')!='noul':
        raise ProbeError('invalid-answer-type')
    p=answer.get('noul')
    try:
        if p is None: raise ValueError()
        benchmark.decision(p,.9)
    except (ValueError,TypeError):
        raise ProbeError('invalid-probability') from None
    usage=data.get('usage')
    if not isinstance(usage,dict) or any(type(usage.get(k)) is not int or usage[k]<0 for k in ['input_tokens','output_tokens']):
        raise ProbeError('invalid-usage')
    return p,{k:usage[k] for k in ['input_tokens','output_tokens']}


def request(body, key, timeout):
    req=urllib.request.Request(ENDPOINT, data=json.dumps(body,ensure_ascii=False).encode('utf-8'),
                               headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'}, method='POST')
    try:
        with urllib.request.build_opener(NoRedirect).open(req,timeout=timeout) as response:
            raw=response.read(1024*1024+1)
        if len(raw)>1024*1024: raise ProbeError('response-too-large')
        return parse_response(json.loads(raw))
    except urllib.error.HTTPError as exc:
        # Do not read or persist error bodies, headers, or the API key.
        raise ProbeError('http-'+str(exc.code)) from None
    except (urllib.error.URLError,OSError,TimeoutError):
        raise ProbeError('network-error') from None
    except (ValueError,UnicodeError):
        raise ProbeError('invalid-json') from None


def evaluate(standard, rows, call, max_requests, max_seconds):
    started=time.perf_counter()
    attempts=0
    stop_reason=None
    results=[]
    input_tokens=output_tokens=0
    unknown_usage_requests=0
    all_times=[]
    for row in rows:
        scores=[]
        times=[]
        for _ in range(standard['repetitions']):
            if stop_reason: break
            if attempts>=max_requests:
                stop_reason='request-budget-exhausted'
                break
            if time.perf_counter()-started>=max_seconds:
                stop_reason='time-budget-exhausted'
                break
            attempts+=1
            tick=time.perf_counter()
            try:
                p,usage=call(payload(row,standard))
            except ProbeError as exc:
                stop_reason=str(exc)
                unknown_usage_requests+=1
                break
            elapsed=(time.perf_counter()-tick)*1000
            scores.append(p)
            times.append(elapsed)
            all_times.append(elapsed)
            input_tokens+=usage['input_tokens']
            output_tokens+=usage['output_tokens']
        complete=len(scores)==standard['repetitions']
        stable=complete and max(scores)-min(scores)<=1e-5
        p=scores[0] if stable else None
        results.append({**row,'pSupport':p,'decision':benchmark.decision(p,standard['threshold']),
                        'latencyMs':times,'repeatProbabilities':scores,
                        'error':None if stable else 'unstable-repetitions' if complete else stop_reason})
    summary={split:benchmark.metrics([r for r in results if r['split']==split]) for split in ['development','validation']}
    summary['validationEntries']=benchmark.metrics([r for r in results if r['split']=='validation' and r['track']=='entry'])
    summary['validationWikiClaims']=benchmark.metrics([r for r in results if r['track']=='wiki'])
    summary['wikiPages']=benchmark.page_metrics(results)
    sensitivity={str(t):benchmark.metrics([{**r,'decision':benchmark.decision(r['pSupport'],t)} for r in results if r['split']=='validation']) for t in standard['sensitivityThresholds']}
    ordered=sorted(all_times)
    return {'model':MODEL,'endpoint':ENDPOINT,'stopReason':stop_reason,'attemptedRequests':attempts,
            'usage':{'input_tokens':input_tokens,'output_tokens':output_tokens,'requestsWithUnknownUsage':unknown_usage_requests},
            'estimatedKnownUsageUsd':input_tokens/1e6*PRICE_PER_MILLION,
            'latencyP50Ms':statistics.median(ordered) if ordered else None,
            'latencyP95Ms':ordered[math.ceil(.95*len(ordered))-1] if ordered else None,
            'summary':summary,'sensitivity':sensitivity,'results':results}


def credentials(key_file):
    try:
        key=key_file.read_text(encoding='utf-8').strip() if key_file else os.environ.get('TYPESAFE_API_KEY','').strip()
    except (OSError,UnicodeError):
        raise ProbeError('credential-file-unreadable') from None
    if not key or any(c.isspace() for c in key):
        raise ProbeError('missing-or-invalid-credential')
    return key


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--run',action='store_true',help='Send synthetic cases to the official paid API. Otherwise preview only.')
    parser.add_argument('--key-file',type=Path,help='Read a key from a local file, preferably outside the repository; never copied to reports.')
    parser.add_argument('--output',type=Path,default=ROOT/'artifacts/jev-review-benchmark.json')
    parser.add_argument('--max-requests',type=int,default=156)
    parser.add_argument('--standard',type=Path,default=benchmark.STANDARD)
    args=parser.parse_args()
    standard=json.loads(args.standard.read_text(encoding='utf-8'))
    rows=benchmark.cases(standard)
    if not 1<=args.max_requests<=len(rows)*standard['repetitions']:
        parser.error('--max-requests must be between 1 and the standard request count')
    timeout=30
    max_seconds=600
    metadata={'schema':1,'standardId':standard['id'],'standardSha256':benchmark.sha(args.standard),
              'developmentSha256':benchmark.sha(ROOT/standard['developmentDataset']),
              'adapterSha256':benchmark.sha(Path(__file__)),'metricsScriptSha256':benchmark.sha(ROOT/'scripts/benchmark-knowledge-reviewers.py'),
              'qualityGate':'not-evaluated-synthetic','maxRequests':args.max_requests,
              'requestTimeoutSeconds':timeout,'stopStartingRequestsAfterSeconds':max_seconds,'automaticRetries':0,
              'priceUsdPerMillionInputTokens':PRICE_PER_MILLION,
              'limits':['Only frozen synthetic fixtures are sent; no project knowledge or credentials in reports.',
                        'Same question, cases, thresholds and three-repetition stability rule as local benchmark.',
                        'Cloud latency includes network/service; no comparable server RAM or CPU measurement.',
                        'Jev tokenizer is unavailable locally; 512-token parity cannot be verified, input text is the same.',
                        'No warmup API request; first call latency is included. No automatic retries or resume.',
                        'Usage is known only for validated successful responses; failed requests may still be billed.',
                        'Time limit checked before each request; one final request can exceed it by the timeout.']}
    if not args.run:
        print(json.dumps({'mode':'preview-no-network','model':MODEL,'endpoint':ENDPOINT,'cases':len(rows),
                          'maximumRequests':args.max_requests,'standardSha256':metadata['standardSha256'],
                          'credentialSources':['TYPESAFE_API_KEY','--key-file'],'estimatedPriceFormula':'reported input tokens / 1000000 * 0.042 USD'},indent=2))
        return
    try:
        key=credentials(args.key_file)
        report=evaluate(standard,rows,lambda body:request(body,key,timeout),args.max_requests,max_seconds)
    except ProbeError as exc:
        parser.exit(2,str(exc)+'\n')
    benchmark.write_json(args.output,{**metadata,**report})
    print(json.dumps({'model':MODEL,'stopReason':report['stopReason'],'requests':report['attemptedRequests'],
                      'usage':report['usage'],'estimatedKnownUsageUsd':report['estimatedKnownUsageUsd'],
                      'summary':report['summary']},ensure_ascii=False,indent=2))
    if report['stopReason'] or any(r['pSupport'] is None for r in report['results']):
        raise SystemExit(2)


if __name__=='__main__': main()
