"""Local Nimble System One evaluation with fixed evidence and bounded resources.
Note: see .agents/notes/knowledge/requirements/unified-memory-laya-primary.md
"""
import argparse
import importlib.util
import json
import math
import os
from pathlib import Path
import socket
import statistics
import subprocess
import threading
import time
import urllib.error
import urllib.request

import psutil

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('benchmark', ROOT/'scripts/benchmark-knowledge-reviewers.py')
benchmark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(benchmark)
MODEL = 'nimble:9b-q4_K_M'
ALIAS = 'nimble-review:q4-k-m-ctx2048'
MODEL_SHA = '0e228c45932655a4b97b175eba79a578e180778ce0d576a10b86f8726962d993'
PORT = 18792
BASE = f'http://127.0.0.1:{PORT}'
PARAMETERS = {'num_ctx': 2048, 'num_batch': 128, 'num_thread': 4}


class ProbeError(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ProbeError('redirect-refused')


def request(path, body=None, timeout=120):
    if not path.startswith('/') or path.startswith('//'):
        raise ProbeError('invalid-local-path')
    req = urllib.request.Request(BASE+path,
        data=json.dumps(body, ensure_ascii=False).encode('utf-8') if body is not None else None,
        headers={'Content-Type': 'application/json'})
    try:
        # Explicitly bypass ambient proxies; synthetic inputs stay on loopback.
        with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect).open(req, timeout=timeout) as response:
            raw = response.read(2*1024**2+1)
        if len(raw)>2*1024**2:
            raise ProbeError('response-too-large')
        return json.loads(raw)
    except urllib.error.HTTPError as exc:
        raise ProbeError('http-'+str(exc.code)) from None
    except (OSError, urllib.error.URLError):
        raise ProbeError('network-error') from None
    except (ValueError, UnicodeError):
        raise ProbeError('invalid-json') from None


def payload(row, standard):
    return {'model': ALIAS, 'keep_alive': '10m',
        'state': json.dumps({'candidate': row['claim'], 'evidence': [row['evidence']], 'existing_facts': []}, ensure_ascii=False),
        'questions': {'support': {'type': 'noul', 'instructions': standard['layaQuestion']}}}


def parse(data):
    if not isinstance(data, dict) or data.get('model') != ALIAS:
        raise ProbeError('unexpected-model')
    answers = data.get('answers')
    if not isinstance(answers, dict) or set(answers) != {'support'}:
        raise ProbeError('invalid-answers')
    answer = answers['support']
    if not isinstance(answer, dict) or answer.get('type') != 'noul':
        raise ProbeError('invalid-answer-type')
    p = answer.get('noul')
    try:
        if p is None:
            raise ValueError()
        benchmark.decision(p, .9)
    except (ValueError, TypeError):
        raise ProbeError('invalid-probability') from None
    usage = data.get('usage')
    if not isinstance(usage, dict) or any(type(usage.get(k)) is not int or usage[k]<0 for k in ['input_tokens', 'output_tokens']):
        raise ProbeError('invalid-usage')
    if usage['input_tokens']>PARAMETERS['num_ctx'] or usage['output_tokens'] != 1:
        raise ProbeError('unexpected-token-count')
    return {'pSupport': p, 'usage': usage}


def project(row, p, threshold):
    return {**row, 'pSupport': p, 'decision': benchmark.decision(p, threshold)}


def summarize(rows, standard):
    repetitions = standard['repetitions']
    def group(projected):
        return {'all': benchmark.metrics(projected),
            'byDataset': {d: benchmark.metrics([r for r in projected if r['dataset']==d]) for d in sorted({r['dataset'] for r in rows})},
            'wikiPages': benchmark.page_metrics(projected)}
    by_repeat = []
    for i in range(repetitions):
        projected = [project(r, r['runs'][i].get('pSupport') if len(r['runs'])>i else None, standard['threshold']) for r in rows]
        by_repeat.append({'repeat': i+1, **group(projected)})
    strict = []; agreed = []; numeric_flips = []; class_flips = []; action_flips = []
    for row in rows:
        scores = [r.get('pSupport') for r in row['runs']]
        complete = len(scores)==repetitions and None not in scores
        stable = complete and max(scores)-min(scores)<=1e-5
        if complete:
            if not stable: numeric_flips.append(row['id'])
            if len({p>=.5 for p in scores})>1: class_flips.append(row['id'])
            if len({benchmark.decision(p, standard['threshold']) for p in scores})>1: action_flips.append(row['id'])
        strict.append(project(row, scores[0] if stable else None, standard['threshold']))
        same_action = complete and len({benchmark.decision(p, standard['threshold']) for p in scores})==1
        agreed.append(project(row, min(scores) if same_action else None, standard['threshold']))
    sensitivity = {str(t): [benchmark.metrics([project(r, r['runs'][i].get('pSupport') if len(r['runs'])>i else None, t)
        for r in rows if r['dataset']=='expanded-validation']) for i in range(repetitions)] for t in standard['sensitivityThresholds']}
    return {'byRepeat': by_repeat, 'strictNumericStability': group(strict),
        'actionAgreementDiagnostic': group(agreed), 'numericFlipIds': numeric_flips,
        'classificationFlipIds': class_flips, 'actionFlipIds': action_flips, 'expandedSensitivityByRepeat': sensitivity}


def gpu():
    out = subprocess.check_output(['nvidia-smi', '--query-gpu=memory.used,memory.free,utilization.gpu', '--format=csv,noheader,nounits'],
        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0), timeout=10).decode().splitlines()[0]
    used, free, utilization = [int(v.strip()) for v in out.split(',')]
    return {'usedMiB': used, 'freeMiB': free, 'utilization': utilization}


def floor_reason(sample):
    if sample['freeMiB']<768: return 'gpu-resource-floor'
    if sample['availableRamMiB']<3072: return 'ram-resource-floor'
    return None


def stop_owned(proc):
    if proc is None: return
    try:
        parent = psutil.Process(proc.pid)
        children = parent.children(recursive=True)
        parent.terminate()
        for child in children:
            try: child.terminate()
            except psutil.NoSuchProcess: pass
        _, alive = psutil.wait_procs([parent, *children], timeout=5)
        for child in alive:
            try: child.kill()
            except psutil.NoSuchProcess: pass
    except psutil.NoSuchProcess:
        pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--server', type=Path, required=True)
    parser.add_argument('--models', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--limit', type=int, default=0)
    parser.add_argument('--max-seconds', type=int, default=3600)
    args = parser.parse_args()
    if args.limit<0 or args.max_seconds<1: parser.error('Invalid case/time budget')
    with socket.socket() as sock: sock.bind(('127.0.0.1', PORT))
    model_path = args.models/'blobs'/('sha256-'+MODEL_SHA)
    if model_path.stat().st_size!=5629108736 or benchmark.sha(model_path)!=MODEL_SHA:
        raise SystemExit('Pinned model digest mismatch')
    original = json.loads(benchmark.STANDARD.read_text(encoding='utf-8'))
    expanded_path = ROOT/'tests/fixtures/knowledge-review-expanded-standard.json'
    expanded = json.loads(expanded_path.read_text(encoding='utf-8'))
    for key in ['threshold', 'repetitions', 'layaQuestion', 'sensitivityThresholds']:
        if original[key]!=expanded[key]: raise SystemExit('Incompatible standards')
    rows = [{**r, 'dataset': 'original-'+r['split']} for r in benchmark.cases(original)]
    rows += [{**r, 'dataset': 'expanded-validation'} for r in benchmark.cases(expanded) if r['split']=='validation']
    if len({r['id'] for r in rows})!=len(rows): raise SystemExit('Duplicate combined case ID')
    if args.limit: rows = rows[:args.limit]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    settings = {'OLLAMA_HOST': f'127.0.0.1:{PORT}', 'OLLAMA_MODELS': str(args.models.resolve()),
        'OLLAMA_NO_CLOUD': '1', 'OLLAMA_NUM_PARALLEL': '1', 'OLLAMA_MAX_LOADED_MODELS': '1',
        'OLLAMA_CONTEXT_LENGTH': '2048', 'OLLAMA_GPU_OVERHEAD': str(1024**3),
        'LLAMA_ARG_FIT_TARGET': '1200', 'OLLAMA_VULKAN': '1', 'OLLAMA_LLM_LIBRARY': 'vulkan'}
    env.update(settings)
    baseline = {**gpu(), 'availableRamMiB': psutil.virtual_memory().available/1024**2}
    if baseline['freeMiB']<4000 or baseline['availableRamMiB']<8192:
        raise SystemExit('Need 4000 MiB free GPU and 8 GiB available RAM before start')
    report = {'schema': 1, 'kind': 'local-nimble-systemone', 'qualityGate': 'not-evaluated-synthetic',
        'model': MODEL, 'requestModel': ALIAS, 'modelSha256': MODEL_SHA, 'parameters': PARAMETERS,
        'scriptSha256': benchmark.sha(Path(__file__)), 'serverSha256': benchmark.sha(args.server),
        'standardSha256': benchmark.sha(benchmark.STANDARD), 'expandedSha256': benchmark.sha(expanded_path),
        'developmentSha256': benchmark.sha(ROOT/original['developmentDataset']),
        'environment': settings, 'baselineResources': baseline, 'repetitions': original['repetitions'],
        'threshold': original['threshold'], 'requestExample': payload(rows[0], original), 'requestOrder': 'repeat-major',
        'limits': ['Synthetic correlated evidence checks, not independent production acceptance.',
            'One noul question per request, same input and question as Jev; no generated confidence text.',
            'Q4 quantization and 2048 context, not full 8K testing.',
            'GPU samples include other applications; process-tree RSS may count shared pages more than once.',
            'Ollama System One internally reuses prompt prefixes. Repeats traverse the whole dataset, not three consecutive identical requests; latency is not a cache-disabled comparison with Qwen.',
            'First scored call includes cold prompt/kernel work; separately recorded model loading excluded from request latency.'],
        'results': [{**r, 'runs': []} for r in rows]}
    samples = []; monitor_errors = []; stops = []; stop = threading.Event(); proc = None
    started = time.monotonic(); latencies = []; stop_reason = None
    def monitor():
        while not stop.wait(1):
            try:
                parent = psutil.Process(proc.pid)
                rss = parent.memory_info().rss
                for child in parent.children(recursive=True):
                    try: rss += child.memory_info().rss
                    except psutil.NoSuchProcess: pass
                sample = {**gpu(), 'availableRamMiB': psutil.virtual_memory().available/1024**2,
                    'processTreeRssMiB': rss/1024**2, 'elapsedSeconds': time.monotonic()-started}
                samples.append(sample)
                reason = floor_reason(sample)
                if reason:
                    stops.append(reason); stop_owned(proc); return
            except (OSError, ValueError, subprocess.SubprocessError, psutil.Error) as exc:
                monitor_errors.append(type(exc).__name__); stops.append('resource-monitor-failed'); stop_owned(proc); return
    try:
        with args.output.with_suffix('.server.log').open('w', encoding='utf-8') as log:
            proc = subprocess.Popen([str(args.server.resolve()), 'serve'], stdout=log, stderr=log, env=env,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            watcher = threading.Thread(target=monitor, daemon=True); watcher.start()
            for _ in range(60):
                if stops: raise ProbeError(stops[0])
                if proc.poll() is not None: raise ProbeError('server-exited')
                try:
                    report['serverVersion'] = request('/api/version', timeout=2); break
                except ProbeError: time.sleep(1)
            else: raise ProbeError('server-start-timeout')
            report['create'] = request('/api/create', {'model': ALIAS, 'from': MODEL, 'parameters': PARAMETERS, 'stream': False})
            info = request('/api/show', {'model': ALIAS})
            if info.get('details', {}).get('quantization_level')!='Q4_K_M': raise ProbeError('unexpected-quantization')
            report['modelDetails'] = {k: info.get(k) for k in ['details', 'parameters', 'model_info', 'capabilities']}
            tick = time.monotonic()
            report['loadResponse'] = request('/api/generate', {'model': ALIAS, 'keep_alive': '10m', 'stream': False}, timeout=240)
            report['loadSeconds'] = time.monotonic()-tick
            report['loadedModels'] = request('/api/ps')
            print(json.dumps({'ready': True, 'loadSeconds': report['loadSeconds'], 'loadedModels': report['loadedModels']}), flush=True)
            benchmark.write_json(args.output, report)
            for repeat in range(original['repetitions']):
                for index, row in enumerate(report['results']):
                    if stops: raise ProbeError(stops[0])
                    if time.monotonic()-started>args.max_seconds: raise ProbeError('time-budget')
                    tick = time.monotonic()
                    try:
                        result = parse(request('/v1/systemone', payload(row, original)))
                    except ProbeError as exc:
                        row['runs'].append({'error': str(exc), 'latencyMs': (time.monotonic()-tick)*1000})
                        raise
                    result['latencyMs'] = (time.monotonic()-tick)*1000
                    latencies.append(result['latencyMs']); row['runs'].append(result)
                    if index%10==0 or index==len(rows)-1:
                        print(json.dumps({'repeat': repeat+1, 'completedInRepeat': index+1, 'totalCases': len(rows), 'elapsedSeconds': round(time.monotonic()-started),
                            'resources': samples[-1] if samples else None}), flush=True)
                        benchmark.write_json(args.output, report)
    except ProbeError as exc:
        stop_reason = stops[0] if stops else str(exc)
    except Exception as exc:
        stop_reason = 'unexpected-'+type(exc).__name__
    finally:
        stop.set()
        if 'watcher' in locals(): watcher.join(timeout=12)
        stop_owned(proc)
        if stops: stop_reason = stops[0]
        report.update(stopReason=stop_reason, summary=summarize(report['results'], original),
            elapsedSeconds=time.monotonic()-started, resourceSamples=samples, resourceMonitorErrors=monitor_errors,
            completedRequests=len(latencies), attemptedRequests=sum(len(r['runs']) for r in report['results']),
            latencyP50Ms=statistics.median(latencies) if latencies else None,
            latencyP95Ms=sorted(latencies)[math.ceil(.95*len(latencies))-1] if latencies else None)
        benchmark.write_json(args.output, report)
    print(json.dumps({'output': str(args.output), 'stopReason': stop_reason, 'completedRequests': len(latencies), 'latencyP50Ms': report['latencyP50Ms']}), flush=True)
    if stop_reason: raise SystemExit(2)


if __name__=='__main__': main()
