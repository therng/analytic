@echo off
rem docs-sync scheduled check (report-only): appends docs-impact --check
rem output to logs\docs-impact-cron.log. Never edits files, never commits.
cd /d C:\analytic
if not exist logs mkdir logs
echo ==== %date% %time% ====>> logs\docs-impact-cron.log
node .claude\skills\docs-sync\scripts\docs-impact.mjs --check >> logs\docs-impact-cron.log 2>&1
