#!/usr/bin/env python3
"""
MT5 HTML Report Parser — standalone CLI tool
Outputs standardized JSON per references/json-schema.md

Usage:
    python parse_mt5.py --input report.html [--output report.json] [--charts charts/]
"""

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

try:
    from bs4 import BeautifulSoup
except ImportError:
    print("pip install beautifulsoup4 lxml", file=sys.stderr)
    sys.exit(1)

BKK = timezone(timedelta(hours=7))


# ── Encoding ──────────────────────────────────────────────────────────────────

def decode_mt5(raw: bytes) -> str:
    if raw[:2] == b'\xff\xfe':
        return raw.decode('utf-16-le')
    if raw[:2] == b'\xfe\xff':
        return raw[2:].decode('utf-16-be')
    if raw[:3] == b'\xef\xbb\xbf':
        return raw[3:].decode('utf-8')
    return raw.decode('utf-8')


# ── Number parsing ────────────────────────────────────────────────────────────

NBSP = ' '

def parse_number(text: str) -> float:
    if text is None:
        return 0.0
    text = text.replace(NBSP, '').replace(' ', '').strip()
    if not text:
        return 0.0
    negative = text.startswith('(') and text.endswith(')')
    if negative:
        text = text[1:-1]
    if '-' in text and not text.startswith('-'):
        negative = True
    text = text.lstrip('-').replace(',', '')
    try:
        val = float(text)
        return -val if negative else val
    except ValueError:
        return 0.0

def parse_number_maybe(text: str):
    if not text or not any(c.isdigit() for c in text):
        return None
    return parse_number(text)

def parse_drawdown_cell(text: str):
    """'800.00 (8.50%)' → (primary_float, pct_float)"""
    text = text.strip().replace(NBSP, '')
    paren_match = re.search(r'\(([^)]+)\)', text)
    outside = re.sub(r'\([^)]+\)', '', text).strip()
    paren_val = parse_number(paren_match.group(1).replace('%', '')) if paren_match else None
    outside_val = parse_number(outside.replace('%', '')) if outside else None
    return outside_val, paren_val

def parse_count_pct(text: str):
    """'45 (62.22%)' → (count=45, won=28)"""
    text = text.strip()
    count_match = re.match(r'^(\d+)', text)
    pct_match = re.search(r'(\d+\.?\d*)\s*%', text)
    count = int(count_match.group(1)) if count_match else 0
    pct = float(pct_match.group(1)) if pct_match else 0.0
    won = round(count * pct / 100)
    return count, won


# ── Date parsing ──────────────────────────────────────────────────────────────

DATE_PATTERNS = [
    r'(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2}):(\d{2})',
    r'(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})',
    r'(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})',
]

def parse_date(text: str):
    if not text:
        return None
    for pat in DATE_PATTERNS:
        m = re.search(pat, text.strip())
        if m:
            parts = [int(x) for x in m.groups()]
            try:
                if parts[0] < 100:  # DD.MM.YYYY
                    dt = datetime(parts[2], parts[1], parts[0], parts[3], parts[4], parts[5])
                else:
                    dt = datetime(*parts)
                return dt.replace(tzinfo=BKK).isoformat()
            except ValueError:
                continue
    return None

def to_iso(text: str):
    return parse_date(text)


# ── Section detection ─────────────────────────────────────────────────────────

SECTION_PATTERNS = [
    (re.compile(r'open\s+positions?', re.I), 'open_positions'),
    (re.compile(r'working\s+orders?', re.I), 'working_orders'),
    (re.compile(r'\bdeals?\b', re.I), 'deals'),
    (re.compile(r'\bpositions?\b', re.I), 'positions'),
    (re.compile(r'\borders?\b', re.I), 'orders'),
    (re.compile(r'\bsummary\b', re.I), 'summary'),
]

def detect_section(text: str):
    t = text.strip()
    for pat, name in SECTION_PATTERNS:
        if pat.search(t):
            return name
    return None

KNOWN_HEADERS = {'time', 'open time', 'close time', 'position', 'deal', 'order',
                 'symbol', 'type', 'volume', 'price', 's/l', 't/p', 'commission',
                 'swap', 'profit', 'balance', 'state', 'comment', 'direction'}

def is_header_row(cells: list) -> bool:
    if len(cells) < 2:
        return False
    normalized = [c.lower().replace(' ', ' ').strip().rstrip(':') for c in cells]
    return sum(1 for c in normalized if c in KNOWN_HEADERS) >= 2

def build_header_map(cells: list) -> dict:
    m = {}
    for i, c in enumerate(cells):
        key = c.lower().replace(' ', ' ').strip().rstrip(':')
        m.setdefault(key, []).append(i)
    return m

def get_col(cells, hmap, keys, fallback=-1, occurrence='first'):
    for key in keys:
        idxs = hmap.get(key, [])
        if idxs:
            idx = idxs[0] if occurrence == 'first' else idxs[-1]
            if 0 <= idx < len(cells):
                return cells[idx]
    if 0 <= fallback < len(cells):
        return cells[fallback]
    return ''


# ── Row parsers ───────────────────────────────────────────────────────────────

def parse_position_row(cells, hmap):
    open_time = to_iso(get_col(cells, hmap, ['time', 'open time'], 0))
    pos_no = get_col(cells, hmap, ['position', 'ticket'], 1)
    close_time = to_iso(get_col(cells, hmap, ['close time', 'time'], fallback=8, occurrence='last'))
    open_price = parse_number_maybe(get_col(cells, hmap, ['price', 'open price'], 5))
    close_price = parse_number_maybe(get_col(cells, hmap, ['price', 'close price'], fallback=9, occurrence='last'))
    if not open_time or not pos_no or not close_time:
        return None
    if not open_price or not close_price or open_price <= 0 or close_price <= 0:
        return None
    commission = parse_number(get_col(cells, hmap, ['commission'], 10))
    swap = parse_number(get_col(cells, hmap, ['swap'], 11))
    profit = parse_number(get_col(cells, hmap, ['profit'], 12))
    return {
        'position_no': pos_no,
        'symbol': get_col(cells, hmap, ['symbol'], 2) or 'UNKNOWN',
        'type': get_col(cells, hmap, ['type'], 3).lower(),
        'volume': parse_number(get_col(cells, hmap, ['volume'], 4)),
        'open_time': open_time,
        'open_price': open_price,
        'sl': parse_number_maybe(get_col(cells, hmap, ['s/l', 'sl'], -1)),
        'tp': parse_number_maybe(get_col(cells, hmap, ['t/p', 'tp'], -1)),
        'close_time': close_time,
        'close_price': close_price,
        'commission': commission,
        'swap': swap,
        'profit': profit,
        'comment': get_col(cells, hmap, ['comment'], -1) or None,
        'net_pnl': round(profit + swap + commission, 5),
    }

def parse_deal_row(cells, hmap):
    time = to_iso(get_col(cells, hmap, ['time'], 0))
    deal_id = get_col(cells, hmap, ['deal', 'ticket'], 1)
    if not time or not deal_id:
        return None
    commission = parse_number(get_col(cells, hmap, ['commission'], 8))
    fee = parse_number(get_col(cells, hmap, ['fee'], 9))
    swap = parse_number(get_col(cells, hmap, ['swap', 'storage'], 10))
    profit = parse_number(get_col(cells, hmap, ['profit'], 11))
    balance_after = parse_number_maybe(get_col(cells, hmap, ['balance'], 12))
    symbol = get_col(cells, hmap, ['symbol'], 2) or None
    direction = get_col(cells, hmap, ['direction'], 4) or None
    return {
        'deal_id': deal_id,
        'time': time,
        'symbol': symbol,
        'type': get_col(cells, hmap, ['type'], 3).lower(),
        'direction': direction.lower() if direction else None,
        'volume': parse_number(get_col(cells, hmap, ['volume'], 5)),
        'price': parse_number_maybe(get_col(cells, hmap, ['price'], 6)),
        'order_id': get_col(cells, hmap, ['order'], 7) or None,
        'commission': commission,
        'fee': fee,
        'swap': swap,
        'profit': profit,
        'balance_after': balance_after,
        'comment': get_col(cells, hmap, ['comment'], -1) or None,
    }

def parse_open_position_row(cells, hmap):
    open_time = to_iso(get_col(cells, hmap, ['time', 'open time'], 0))
    pos_id = get_col(cells, hmap, ['position', 'ticket'], 1)
    if not open_time or not pos_id:
        return None
    return {
        'position_id': pos_id,
        'open_time': open_time,
        'symbol': get_col(cells, hmap, ['symbol'], 2) or 'UNKNOWN',
        'type': get_col(cells, hmap, ['type'], 3).lower(),
        'volume': parse_number(get_col(cells, hmap, ['volume'], 4)),
        'open_price': parse_number(get_col(cells, hmap, ['price', 'open price'], 5)),
        'sl': parse_number_maybe(get_col(cells, hmap, ['s/l', 'sl'], -1)),
        'tp': parse_number_maybe(get_col(cells, hmap, ['t/p', 'tp'], -1)),
        'market_price': parse_number(get_col(cells, hmap, ['market price', 'price'], fallback=8, occurrence='last')),
        'swap': parse_number(get_col(cells, hmap, ['swap'], 9)),
        'floating_profit': parse_number(get_col(cells, hmap, ['profit'], 10)),
        'comment': get_col(cells, hmap, ['comment'], -1) or None,
    }


# ── Metadata & summary parsers ────────────────────────────────────────────────

META_LABELS = {
    'name': 'owner_name', 'owner': 'owner_name',
    'account': 'account_number', 'login': 'account_number',
    'company': 'company', 'currency': 'currency', 'server': 'server',
}
SUMMARY_LABELS = {
    'balance': 'balance', 'credit facility': 'credit_facility',
    'equity': 'equity', 'margin': 'margin', 'free margin': 'free_margin',
    'floating p/l': 'floating_pl', 'floating pl': 'floating_pl',
    'margin level': 'margin_level',
}
METRICS_LABELS = {
    'total net profit': 'total_net_profit',
    'gross profit': 'gross_profit', 'gross loss': 'gross_loss',
    'profit factor': 'profit_factor', 'expected payoff': 'expected_payoff',
    'recovery factor': 'recovery_factor', 'sharpe ratio': 'sharpe_ratio',
    'total trades': 'total_trades',
    'commission': 'total_commission', 'total commission': 'total_commission',
    'swap': 'total_swap', 'total swap': 'total_swap',
    'balance drawdown absolute': ('drawdown', 'absolute', 'simple'),
    'balance drawdown maximal': ('drawdown', 'maximal', 'amount_pct'),
    'balance drawdown relative': ('drawdown', 'relative', 'pct_amount'),
    'profit trades': ('win_stats', 'profit_trades', 'int'),
    'loss trades': ('win_stats', 'loss_trades', 'int'),
    'largest profit trade': ('win_stats', 'largest_profit_trade', 'float'),
    'largest loss trade': ('win_stats', 'largest_loss_trade', 'float'),
    'average profit trade': ('win_stats', 'average_profit_trade', 'float'),
    'average loss trade': ('win_stats', 'average_loss_trade', 'float'),
}


# ── Main parser ───────────────────────────────────────────────────────────────

def parse_report(html: str, file_hash: str = '') -> dict:
    soup = BeautifulSoup(html, 'lxml')

    result = {
        'meta': {
            'account_number': '', 'owner_name': '', 'company': '',
            'currency': 'USD', 'server': 'UNKNOWN',
            'account_type': '', 'margin_type': '',
            'report_timestamp': None,
            'file_hash': f'sha256:{file_hash}' if file_hash else '',
        },
        'summary': {
            'balance': 0.0, 'credit_facility': 0.0, 'equity': 0.0,
            'margin': 0.0, 'free_margin': 0.0, 'floating_pl': 0.0,
            'margin_level': None,
        },
        'metrics': {
            'total_net_profit': 0.0, 'gross_profit': 0.0, 'gross_loss': 0.0,
            'total_commission': 0.0, 'total_swap': 0.0,
            'profit_factor': 0.0, 'expected_payoff': 0.0,
            'recovery_factor': 0.0, 'sharpe_ratio': 0.0, 'total_trades': 0,
            'drawdown': {
                'absolute': 0.0, 'maximal_amount': 0.0, 'maximal_pct': 0.0,
                'relative_pct': 0.0, 'relative_amount': 0.0,
            },
            'win_stats': {
                'short_total': 0, 'short_won': 0, 'long_total': 0, 'long_won': 0,
                'profit_trades': 0, 'loss_trades': 0,
                'largest_profit_trade': 0.0, 'largest_loss_trade': 0.0,
                'average_profit_trade': 0.0, 'average_loss_trade': 0.0,
                'max_consecutive_wins_count': 0, 'max_consecutive_wins_amount': 0.0,
                'max_consecutive_losses_count': 0, 'max_consecutive_losses_amount': 0.0,
                'maximal_consecutive_profit_amount': 0.0, 'maximal_consecutive_profit_count': 0,
                'maximal_consecutive_loss_amount': 0.0, 'maximal_consecutive_loss_count': 0,
                'average_consecutive_wins': 0.0, 'average_consecutive_losses': 0.0,
            },
        },
        'positions': [],
        'deals': [],
        'open_positions': [],
        'working_orders': [],
    }

    # Extract metadata from header rows
    for row in soup.find_all('tr'):
        cells = [td.get_text(' ', strip=True).replace(NBSP, ' ').strip() for td in row.find_all(['td', 'th'])]
        cells = [c for c in cells if c]
        if len(cells) < 2:
            continue
        for i in range(0, len(cells) - 1, 2):
            label = cells[i].rstrip(':').lower().strip()
            value = cells[i + 1].strip()
            if label in META_LABELS:
                key = META_LABELS[label]
                if key == 'account_number':
                    m = re.search(r'\d{4,}', value)
                    if m and not result['meta']['account_number']:
                        result['meta']['account_number'] = m.group()
                    paren = re.search(r'\(([^)]+)\)', value)
                    if paren:
                        parts = [p.strip() for p in paren.group(1).split(',')]
                        if parts and not result['meta']['currency']:
                            result['meta']['currency'] = parts[0]
                        if len(parts) > 1 and not result['meta']['server']:
                            result['meta']['server'] = parts[1]
                elif not result['meta'][key]:
                    result['meta'][key] = value
            elif label in ('date', 'to', 'report time'):
                if not result['meta']['report_timestamp']:
                    result['meta']['report_timestamp'] = to_iso(value)
            elif label in SUMMARY_LABELS:
                result['summary'][SUMMARY_LABELS[label]] = parse_number(value)

    # Parse tables by section
    current_section = None
    hmap = {}

    for row in soup.find_all('tr'):
        cells_raw = row.find_all(['td', 'th'])
        # filter hidden
        cells = []
        for td in cells_raw:
            cls = td.get('class', [])
            style = td.get('style', '')
            if 'hidden' in ' '.join(cls).lower() or 'display:none' in style.replace(' ', '').lower():
                continue
            cells.append(td.get_text(' ', strip=True).replace(NBSP, ' ').strip())
        cells = [c for c in cells if c or len(cells) > 1]

        if not cells:
            continue

        combined = ' '.join(cells)
        section = detect_section(combined) if len(cells) <= 3 else None
        if section:
            current_section = section
            hmap = {}
            continue

        if is_header_row(cells):
            hmap = build_header_map(cells)
            continue

        # Summary / metrics label:value pairs
        for i in range(0, len(cells) - 1, 2):
            lbl = cells[i].rstrip(':').lower().strip()
            val = cells[i + 1].strip() if i + 1 < len(cells) else ''

            if lbl in SUMMARY_LABELS:
                result['summary'][SUMMARY_LABELS[lbl]] = parse_number(val)
                continue

            if lbl.startswith('short trades'):
                cnt, won = parse_count_pct(val)
                result['metrics']['win_stats']['short_total'] = cnt
                result['metrics']['win_stats']['short_won'] = won
                continue
            if lbl.startswith('long trades'):
                cnt, won = parse_count_pct(val)
                result['metrics']['win_stats']['long_total'] = cnt
                result['metrics']['win_stats']['long_won'] = won
                continue

            if lbl.startswith('maximum consecutive wins'):
                m = re.match(r'(\d+)', val)
                amt_m = re.search(r'\(([^)]+)\)', val)
                if m:
                    result['metrics']['win_stats']['max_consecutive_wins_count'] = int(m.group(1))
                if amt_m:
                    result['metrics']['win_stats']['max_consecutive_wins_amount'] = parse_number(amt_m.group(1))
                continue
            if lbl.startswith('maximum consecutive losses'):
                m = re.match(r'(\d+)', val)
                amt_m = re.search(r'\(([^)]+)\)', val)
                if m:
                    result['metrics']['win_stats']['max_consecutive_losses_count'] = int(m.group(1))
                if amt_m:
                    result['metrics']['win_stats']['max_consecutive_losses_amount'] = parse_number(amt_m.group(1))
                continue
            if lbl.startswith('maximal consecutive profit'):
                primary, secondary = parse_drawdown_cell(val)
                result['metrics']['win_stats']['maximal_consecutive_profit_amount'] = primary or 0.0
                result['metrics']['win_stats']['maximal_consecutive_profit_count'] = int(secondary or 0)
                continue
            if lbl.startswith('maximal consecutive loss'):
                primary, secondary = parse_drawdown_cell(val)
                result['metrics']['win_stats']['maximal_consecutive_loss_amount'] = primary or 0.0
                result['metrics']['win_stats']['maximal_consecutive_loss_count'] = int(secondary or 0)
                continue
            if lbl.startswith('average consecutive wins'):
                result['metrics']['win_stats']['average_consecutive_wins'] = parse_number(val)
                continue
            if lbl.startswith('average consecutive losses'):
                result['metrics']['win_stats']['average_consecutive_losses'] = parse_number(val)
                continue

            if lbl in METRICS_LABELS:
                mapping = METRICS_LABELS[lbl]
                if isinstance(mapping, str):
                    v = int(parse_number(val)) if lbl == 'total trades' else parse_number(val)
                    result['metrics'][mapping] = v
                else:
                    _, sub_key, fmt = mapping
                    if fmt == 'simple':
                        result['metrics']['drawdown'][sub_key] = parse_number(val)
                    elif fmt == 'amount_pct':
                        primary, secondary = parse_drawdown_cell(val)
                        result['metrics']['drawdown'][f'{sub_key}_amount'] = primary or 0.0
                        result['metrics']['drawdown'][f'{sub_key}_pct'] = secondary or 0.0
                    elif fmt == 'pct_amount':
                        primary, secondary = parse_drawdown_cell(val)
                        result['metrics']['drawdown'][f'{sub_key}_pct'] = primary or 0.0
                        result['metrics']['drawdown'][f'{sub_key}_amount'] = secondary or 0.0
                    elif fmt == 'int':
                        result['metrics']['win_stats'][f'{sub_key}'] = int(parse_number(val))
                    else:
                        result['metrics']['win_stats'][f'{sub_key}'] = parse_number(val)
                continue

        # Data rows by section
        if current_section == 'positions':
            row_data = parse_position_row(cells, hmap)
            if row_data:
                result['positions'].append(row_data)
        elif current_section == 'deals':
            row_data = parse_deal_row(cells, hmap)
            if row_data:
                result['deals'].append(row_data)
        elif current_section == 'open_positions':
            row_data = parse_open_position_row(cells, hmap)
            if row_data:
                result['open_positions'].append(row_data)

    # Sort
    result['positions'].sort(key=lambda x: x.get('open_time') or '')
    result['deals'].sort(key=lambda x: x.get('time') or '')

    # Infer report timestamp from latest deal if missing
    if not result['meta']['report_timestamp'] and result['deals']:
        result['meta']['report_timestamp'] = result['deals'][-1]['time']

    return result


# ── Visualization ─────────────────────────────────────────────────────────────

def generate_charts(report: dict, output_dir: Path):
    try:
        import matplotlib.pyplot as plt
        import matplotlib.dates as mdates
        from collections import defaultdict
    except ImportError:
        print("pip install matplotlib to generate charts", file=sys.stderr)
        return

    output_dir.mkdir(parents=True, exist_ok=True)
    currency = report['meta'].get('currency', 'USD')

    # 1. Balance curve
    balance_points = [
        (d['time'], d['balance_after'])
        for d in report['deals']
        if d.get('balance_after') is not None
    ]
    if balance_points:
        times = [datetime.fromisoformat(t) for t, _ in balance_points]
        balances = [b for _, b in balance_points]
        fig, ax = plt.subplots(figsize=(12, 4))
        ax.plot(times, balances, linewidth=1.5, color='#2196F3')
        ax.fill_between(times, balances, min(balances), alpha=0.1, color='#2196F3')
        ax.set_title(f"Balance Curve — {report['meta'].get('account_number', '')}")
        ax.set_ylabel(currency)
        ax.xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m'))
        ax.xaxis.set_major_locator(mdates.MonthLocator())
        plt.xticks(rotation=45)
        plt.tight_layout()
        plt.savefig(output_dir / 'balance.png', dpi=150)
        plt.close()

    # 2. Drawdown chart
    if balance_points:
        running_max = 0
        dd_series = []
        for t, b in balance_points:
            running_max = max(running_max, b)
            dd_pct = ((running_max - b) / running_max * 100) if running_max > 0 else 0
            dd_series.append((datetime.fromisoformat(t), dd_pct))
        times_dd = [x[0] for x in dd_series]
        dds = [x[1] for x in dd_series]
        fig, ax = plt.subplots(figsize=(12, 3))
        ax.fill_between(times_dd, dds, alpha=0.6, color='#F44336')
        ax.set_title('Drawdown %')
        ax.set_ylabel('%')
        ax.invert_yaxis()
        ax.xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m'))
        plt.xticks(rotation=45)
        plt.tight_layout()
        plt.savefig(output_dir / 'drawdown.png', dpi=150)
        plt.close()

    # 3. Monthly P/L bar chart
    monthly = defaultdict(float)
    for d in report['deals']:
        if d.get('symbol') and d.get('direction'):
            month = d['time'][:7]
            monthly[month] += d.get('profit', 0) + d.get('commission', 0) + d.get('swap', 0)
    if monthly:
        months = sorted(monthly.keys())
        values = [monthly[m] for m in months]
        colors = ['#4CAF50' if v >= 0 else '#F44336' for v in values]
        fig, ax = plt.subplots(figsize=(max(8, len(months)), 4))
        ax.bar(months, values, color=colors)
        ax.axhline(0, color='black', linewidth=0.5)
        ax.set_title('Monthly P/L (net)')
        ax.set_ylabel(currency)
        plt.xticks(rotation=45)
        plt.tight_layout()
        plt.savefig(output_dir / 'monthly_pnl.png', dpi=150)
        plt.close()

    print(f"Charts saved to {output_dir}/")


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Parse MT5 HTML report to JSON')
    parser.add_argument('--input', required=True, help='Path to .html report file')
    parser.add_argument('--output', help='JSON output path (default: stdout)')
    parser.add_argument('--charts', help='Directory to write chart images (requires matplotlib)')
    parser.add_argument('--pretty', action='store_true', help='Pretty-print JSON')
    args = parser.parse_args()

    raw = Path(args.input).read_bytes()
    html = decode_mt5(raw)
    file_hash = hashlib.sha256(raw).hexdigest()
    report = parse_report(html, file_hash)

    json_str = json.dumps(report, ensure_ascii=False, indent=2 if args.pretty else None)

    if args.output:
        Path(args.output).write_text(json_str, encoding='utf-8')
        print(f"Saved: {args.output}")
    else:
        print(json_str)

    if args.charts:
        generate_charts(report, Path(args.charts))

    # Quick summary
    m = report['meta']
    s = report['summary']
    metrics = report['metrics']
    print(f"\n{'─'*50}", file=sys.stderr)
    print(f"Account : {m['account_number']} ({m['owner_name']})", file=sys.stderr)
    print(f"Balance : {s['balance']:,.2f} {m['currency']}", file=sys.stderr)
    print(f"Equity  : {s['equity']:,.2f}", file=sys.stderr)
    print(f"Trades  : {metrics['total_trades']}", file=sys.stderr)
    print(f"Net P/L : {metrics['total_net_profit']:+,.2f}", file=sys.stderr)
    print(f"P.Factor: {metrics['profit_factor']:.2f}", file=sys.stderr)
    win = metrics['win_stats']
    total = metrics['total_trades']
    wr = win['profit_trades'] / total * 100 if total else 0
    print(f"Win Rate: {wr:.1f}%  ({win['profit_trades']}/{total})", file=sys.stderr)
    print(f"Max DD  : {metrics['drawdown']['maximal_amount']:,.2f} ({metrics['drawdown']['maximal_pct']:.1f}%)", file=sys.stderr)


if __name__ == '__main__':
    main()
