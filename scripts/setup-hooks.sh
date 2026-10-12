#!/bin/sh
# 저장소를 clone한 뒤 한 번만 실행: sh scripts/setup-hooks.sh
cd "$(git rev-parse --show-toplevel)" || exit 1
chmod +x .githooks/*
git config core.hooksPath .githooks
echo "✅ Git 훅 설치 완료 (main 커밋/푸시 차단, 브랜치·커밋 메시지 규칙 검사)"
