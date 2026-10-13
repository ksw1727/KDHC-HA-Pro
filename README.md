# 한난MOA (KDHC-HA-Pro)

취합 해커톤 프로젝트 ('26.10.12). 기획 문서는 [`docs/prd/`](docs/prd/00-overview.md)에 있습니다.

## 처음 한 번만

```bash
git clone https://github.com/ksw1727/KDHC-HA-Pro.git
cd KDHC-HA-Pro
sh scripts/setup-hooks.sh
```

훅을 설치하면 아래 규칙을 git이 자동으로 검사합니다.

## 협업 규칙

1. **`main`에 직접 커밋·push하지 않습니다.** 모든 변경은 PR로 병합합니다.
2. **브랜치 이름**: `타입/작업이름` — 타입은 `feat` `fix` `docs` `refactor` `test` `chore`
3. **커밋 메시지**: `타입: 내용` (예: `feat: 엑셀 양식 생성 화면 추가`)
4. **병합**: 상대방이 PR을 확인한 뒤 *Squash and merge*. 병합된 브랜치는 자동 삭제됩니다.

## 작업 순서

```bash
git switch main && git pull                 # 최신 main 받기
git switch -c feat/작업이름                  # 브랜치 만들기
git add . && git commit -m "feat: 내용"      # 커밋 (여러 번 가능)
git push -u origin feat/작업이름             # push
gh pr create --fill                          # PR 열기 (웹에서도 가능)
```

PR이 병합되면 다시 `git switch main && git pull`로 최신 상태를 받고 다음 작업을 시작합니다.
