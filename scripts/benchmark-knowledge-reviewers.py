"""Pinned, offline evidence-review comparison. No production knowledge writes.
Note: see .agents/notes/2026-09-28-unified-memory-laya-primary--736081fc.md
"""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import contextlib
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import platform
import statistics
import subprocess
import sys
import threading
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
STANDARD = ROOT / 'tests/fixtures/knowledge-review-standard.json'


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()



def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')


def cases(standard):
    result = []
    dev = json.loads((ROOT / standard['developmentDataset']).read_text(encoding='utf-8'))
    for row in dev['cases']:
        result.append({'id': row['id'], 'split': 'development', 'track': 'entry', 'evidence': '\n'.join(row['evidence']),
                       'claim': row['content'], 'supported': row['gold']['support']})
    for row in standard['entries']:
        result.append({**row, 'split': 'validation', 'track': 'entry'})
    for page in standard['wikiPages']:
        for i, claim in enumerate(page['claims']):
            result.append({'id': page['id'] + ':' + str(i), 'page': page['id'], 'split': 'validation', 'track': 'wiki',
                           'evidence': page['evidence'], 'claim': claim['text'], 'supported': claim['supported']})
    if len({r['id'] for r in result}) != len(result):
        raise ValueError('Duplicate case ID')
    for row in result:
        if type(row['supported']) is not bool or not row['evidence'].strip() or not row['claim'].strip():
            raise ValueError('Invalid case')
    dev_inputs = {(r['evidence'], r['claim']) for r in result if r['split'] == 'development'}
    if any((r['evidence'], r['claim']) in dev_inputs for r in result if r['split'] == 'validation'):
        raise ValueError('Exact development/validation input leakage')
    if not .5 < standard['threshold'] < 1 or standard['repetitions'] < 1:
        raise ValueError('Invalid frozen policy')
    return result


def decision(p, threshold):
    if p is None:
        return 'defer'
    if type(p) not in (int, float) or not math.isfinite(p) or not 0 <= p <= 1:
        raise ValueError('Invalid probability')
    return 'pass' if p >= threshold else 'block' if p <= 1 - threshold else 'defer'


def wilson(success, count):
    if not count:
        return None
    z = 1.96
    p = success / count
    center = (p + z*z/(2*count)) / (1+z*z/count)
    margin = z*math.sqrt(p*(1-p)/count+z*z/(4*count*count))/(1+z*z/count)
    return [center-margin, center+margin]


def metrics(rows):
    positives = sum(r['supported'] for r in rows)
    negatives = len(rows) - positives
    tp = sum(r['supported'] and r['pSupport'] is not None and r['pSupport'] >= .5 for r in rows)
    tn = sum(not r['supported'] and r['pSupport'] is not None and r['pSupport'] < .5 for r in rows)
    passed = [r for r in rows if r['decision'] == 'pass']
    right = sum(r['supported'] for r in passed)
    return {'count': len(rows), 'positiveCount': positives, 'negativeCount': negatives,
            'unavailable': sum(r['pSupport'] is None for r in rows),
            'accuracy': (tp+tn)/len(rows) if rows else None,
            'balancedAccuracy': (tp/positives+tn/negatives)/2 if positives and negatives else None,
            'decisions': dict(Counter(r['decision'] for r in rows)),
            'passPrecision': right/len(passed) if passed else None, 'passPrecisionWilson95': wilson(right,len(passed)),
            'correctPassCoverage': right/positives if positives else None,
            'falsePassCount': len(passed)-right,
            'falsePassRate': (len(passed)-right)/negatives if negatives else None,
            'falsePassIds': [r['id'] for r in passed if not r['supported']],
            'missedSupportedIds': [r['id'] for r in rows if r['supported'] and r['decision'] != 'pass']}


def page_metrics(rows):
    pages = {}
    for row in rows:
        if row.get('page'):
            pages.setdefault(row['page'], []).append(row)
    # Every claim must pass. Unknown/missing evidence never disappears from a page denominator.
    aggregated = [{'id': key, 'supported': all(r['supported'] for r in values),
                   'pSupport': min(r['pSupport'] for r in values) if all(r['pSupport'] is not None for r in values) else None,
                   'decision': 'pass' if all(r['decision'] == 'pass' for r in values) else
                               'block' if any(r['decision'] == 'block' for r in values) else 'defer'} for key,values in pages.items()]
    return metrics(aggregated)


def prepare(key, config, cache):
    root = cache/key
    root.mkdir(parents=True, exist_ok=True)
    url = 'https://huggingface.co/api/models/'+config['repo']+'/revision/'+config['revision']+'?blobs=true'
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=60) as response:
                meta = json.load(response)
            break
        except (OSError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(1)
    if meta['sha'] != config['revision']:
        raise ValueError('Model revision mismatch')
    items = {item['rfilename']: item for item in meta['siblings']}
    manifest = {'repo': config['repo'], 'revision': config['revision'], 'files': {}}
    for name in config['files']:
        info = items[name]
        path = root/name
        path.parent.mkdir(parents=True, exist_ok=True)
        def valid(candidate):
            if not candidate.exists() or candidate.stat().st_size != info['size']:
                return False
            if 'lfs' in info:
                return sha(candidate) == info['lfs']['sha256']
            data = candidate.read_bytes()
            return hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest() == info['blobId']
        if not valid(path):
            part = path.with_suffix(path.suffix+'.part')
            download = 'https://huggingface.co/'+config['repo']+'/resolve/'+config['revision']+'/'+name
            print('download', key, name, info['size'], flush=True)
            for attempt in range(3):
                try:
                    with urllib.request.urlopen(download, timeout=120) as response, part.open('wb') as out:
                        total = 0
                        while block := response.read(1024*1024):
                            total += len(block)
                            if total > info['size']:
                                raise ValueError('Download exceeds pinned size')
                            out.write(block)
                    break
                except (OSError, TimeoutError):
                    if attempt == 2:
                        raise
                    time.sleep(1)
            if not valid(part):
                raise ValueError('Artifact hash mismatch')
            os.replace(part, path)
        manifest['files'][name] = {'bytes': info['size'], 'sha256': sha(path)}
    write_json(root/'verified-manifest.json',manifest)


def worker(args, standard):
    import psutil
    process = psutil.Process()
    rss = [process.memory_info().rss]
    stop = threading.Event()
    def sample():
        while not stop.wait(.02):
            rss.append(process.memory_info().rss)
    monitor = threading.Thread(target=sample, daemon=True)
    monitor.start()
    os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1', TOKENIZERS_PARALLELISM='false')
    start = time.perf_counter()
    key = args.worker
    modelkey = 'mdeberta' if key.startswith('mdeberta') else key
    modelroot = args.cache/modelkey
    try:
        manifest=json.loads((modelroot/'verified-manifest.json').read_text(encoding='utf-8'))
        expected=standard['models'][modelkey]
        if manifest['revision']!=expected['revision'] or set(manifest['files'])!=set(expected['files']):
            raise ValueError('Manifest mismatch')
        used=[name for name in manifest['files'] if name!='model.safetensors'] if key.endswith('int8') else [name for name in manifest['files'] if not name.startswith('onnx/')]
        for name in used:
            if sha(modelroot/name)!=manifest['files'][name]['sha256']:
                raise ValueError('Artifact changed')
        from transformers import AutoTokenizer
        tokenizer=AutoTokenizer.from_pretrained(modelroot,local_files_only=True)
        config=json.loads((modelroot/'config.json').read_text(encoding='utf-8'))
        labels=[config['id2label'][str(i)] for i in range(3)]
        if set(labels)!={'entailment','neutral','contradiction'}:
            raise ValueError('Unexpected NLI labels')
        if key.endswith('int8'):
            import onnxruntime as ort
            options=ort.SessionOptions()
            options.intra_op_num_threads=standard['threads']
            options.inter_op_num_threads=1
            model=ort.InferenceSession(str(modelroot/'onnx/model_quantized.onnx'),options,providers=['CPUExecutionProvider'])
            names=[item.name for item in model.get_inputs()]
        else:
            import torch
            from transformers import AutoModelForSequenceClassification
            torch.set_num_threads(standard['threads'])
            torch.set_num_interop_threads(1)
            model=AutoModelForSequenceClassification.from_pretrained(modelroot,local_files_only=True,torch_dtype=torch.float32).eval()
        def predict(row):
            encoded=tokenizer(row['evidence'],row['claim'],truncation=False)
            count=len(encoded['input_ids'])
            if count>standard['maxPairTokens']:
                raise ValueError('token-budget-exceeded')
            if key.endswith('int8'):
                import numpy as np
                inputs={name:np.array([encoded.get(name,[0]*count)],dtype=np.int64) for name in names}
                logits=model.run(None,inputs)[0][0].tolist()
            else:
                with torch.inference_mode():
                    logits=model(**{name:torch.tensor([value]) for name,value in encoded.items()}).logits[0].tolist()
            weights=[math.exp(x-max(logits)) for x in logits]
            distribution={label:weight/sum(weights) for label,weight in zip(labels,weights)}
            return distribution['entailment'],distribution,count
        filebytes=sum(manifest['files'][name]['bytes'] for name in used)
        loaded=time.perf_counter()
        warm={'evidence':'The service uses PostgreSQL.','claim':'The service uses PostgreSQL.'}
        predict(warm)
        warmed=time.perf_counter()
        rows=cases(standard)
        results=[]
        latencies=[]
        for row in rows:
            scores=[]
            times=[]
            distribution=None
            count=None
            error=None
            for _ in range(standard['repetitions']):
                tick=time.perf_counter()
                try:
                    p,distribution,count=predict(row)
                    decision(p,standard['threshold'])
                    scores.append(p)
                except Exception as exc:
                    error=type(exc).__name__+': '+str(exc)
                    break
                times.append((time.perf_counter()-tick)*1000)
            valid=len(scores)==standard['repetitions'] and max(scores)-min(scores)<=1e-5
            p=scores[0] if valid else None
            latencies.extend(times)
            results.append({**row,'pSupport':p,'distribution':distribution,'decision':decision(p,standard['threshold']),
                            'tokens':count,'latencyMs':times,'error':error if error else None if valid else 'unstable-repetitions'})
        summary={split:metrics([r for r in results if r['split']==split]) for split in ['development','validation']}
        summary['validationEntries']=metrics([r for r in results if r['split']=='validation' and r['track']=='entry'])
        summary['validationWikiClaims']=metrics([r for r in results if r['track']=='wiki'])
        summary['wikiPages']=page_metrics(results)
        sensitivity={str(threshold):metrics([{**r,'decision':decision(r['pSupport'],threshold)} for r in results if r['split']=='validation'])
                     for threshold in standard['sensitivityThresholds']}
        ordered=sorted(latencies)
        return {'model':key,'manifest':manifest,'artifactBytesUsed':filebytes,'loadMs':(loaded-start)*1000,
                'warmupMs':(warmed-loaded)*1000,'baselineRssBytes':rss[0], 'peakRssBytes':max(rss+[process.memory_info().rss]),
                'latencyP50Ms':statistics.median(ordered) if ordered else None,
                'latencyP95Ms':ordered[math.ceil(.95*len(ordered))-1] if ordered else None,
                'summary':summary,'sensitivity':sensitivity,'results':results}
    finally:
        stop.set()
        monitor.join(timeout=1)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--standard',type=Path,default=STANDARD)
    parser.add_argument('--cache',type=Path,default=ROOT/'artifacts/knowledge-review-models')
    parser.add_argument('--output',type=Path,default=ROOT/'tests/fixtures/knowledge-review-benchmark-windows.json')
    parser.add_argument('--prepare',action='store_true')
    parser.add_argument('--validate-only',action='store_true')
    parser.add_argument('--worker',choices=['mdeberta','minilm','mdeberta-int8'])
    args=parser.parse_args()
    standard=json.loads(args.standard.read_text(encoding='utf-8'))
    rows=cases(standard)
    if args.validate_only:
        print(json.dumps({'cases':len(rows),'splits':dict(Counter(r['split'] for r in rows))}))
        return
    if args.prepare:
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(lambda item:prepare(item[0],item[1],args.cache),standard['models'].items()))
        return
    if args.worker:
        with contextlib.redirect_stdout(sys.stderr):
            report=worker(args,standard)
        write_json(args.output,report)
        return
    import psutil
    report={'schema':1,'standard':standard,'standardSha256':sha(args.standard),'scriptSha256':sha(Path(__file__)),
            'developmentSha256':sha(ROOT/standard['developmentDataset']), 'qualityGate':'not-evaluated-synthetic',
            'python':platform.python_version(),'platform':platform.platform(),'cpu':platform.processor(),
            'physicalCores':psutil.cpu_count(logical=False),'logicalCores':psutil.cpu_count(), 'systemMemoryBytes':psutil.virtual_memory().total,
            'environment':{name:importlib.metadata.version(name) for name in ['torch','transformers','tokenizers','onnxruntime','psutil','sentencepiece','protobuf','numpy']},
            'measurement':'Fresh process per model, CPU four threads, batch one, one warmup, three repeated sequential measurements per case. Load includes hash verification/imports. Peak RSS sampled every 20ms; no guarantee of cache-cold disk.',
            'limits':['Validation labels are assistant-authored, not independent human labels.',
                      'Repeated and shared wiki claims are correlated; repetitions never enlarge accuracy denominators.',
                      'NLI binary support probability is P(entailment); other classes are not-supported.',
                      'No extraction, full admission policy, source-version transactions, wiki claim extraction/completeness or application deployment tested.'],
            'models':[]}
    args.cache.mkdir(parents=True,exist_ok=True)
    for key in ['mdeberta','minilm','mdeberta-int8']:
        output=args.cache/(key+'-result.json')
        print('benchmark',key,flush=True)
        subprocess.run([sys.executable,str(Path(__file__)),'--worker',key,'--standard',str(args.standard),
                        '--cache',str(args.cache),'--output',str(output)],check=True,timeout=900)
        result=json.loads(output.read_text(encoding='utf-8'))
        report['models'].append(result)
        write_json(args.output,report)
        print(json.dumps({key:result['summary'],'p50':result['latencyP50Ms'],'peakRSS':result['peakRssBytes']}),flush=True)
    if any(m['summary']['development']['unavailable'] or m['summary']['validation']['unavailable'] for m in report['models']):
        raise SystemExit(2)


if __name__=='__main__':
    main()
