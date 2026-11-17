# sashin92-herder

Herdr 세팅 저장소입니다. tmux에서 쓰던 Alt 단축키를 Herdr에서도 그대로 쓰려고 만들었습니다.

herdr-app 0.1.16, hc 0.1.21 기준입니다.

## 설치

Herdr를 켜 둔 상태에서 실행합니다.

```sh
git clone https://github.com/sashin92/sashin92-herder.git
cd sashin92-herder

./install-macos.sh     # macOS
./install-linux.sh     # Linux
```

Windows에서는 PowerShell로 실행합니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
```

- macOS, Linux는 `python3` 필요
- 여러 번 실행 가능 (달라진 것만 변경)
- `git pull` 받은 뒤에도 같은 명령으로 재실행
- Herdr가 꺼져 있었다면 켜고 한 번 더 실행
- 변경 내용 미리 보기: `--dry-run` (Windows는 `-DryRun`)

아래 두 가지는 스크립트가 해 주지 않으니 직접 해야 합니다.

- Jetendard 글꼴 설치
- 원격 머신 등록 (`hc machine add`)

## 단축키

macOS에서는 왼쪽 Option이 Alt입니다.

| 키 | 동작 |
|---|---|
| `Alt+h/j/k/l` | pane 이동 |
| `Alt+Shift+h/j/k/l` | pane 크기 조정 |
| `Alt+1`~`9` | space 이동 |
| `Alt+[` `Alt+]` | 이전, 다음 space |
| `Ctrl+1`~`9` | N번째 에이전트로 이동 (사이드바 순서) |
| `Alt+s` | 전체 목록 + 미리보기 |
| `Alt+z` | pane 줌 |
| `Alt+w` | pane 닫기 (확인창) |
| `Cmd+w` | tab 닫기 (확인창) |

`Cmd+w`는 macOS 기준입니다. 다른 운영체제에서는 원래 tab을 닫던 키가 확인창을 띄웁니다.

### 전체 목록 (`Alt+s`)

컴퓨터 > space > tab > pane 순서로 나옵니다. 오른쪽에는 미리보기가 뜨고, tab이나 space 위에서는 분할된 모양 그대로 보여줍니다.

| 키 | 동작 |
|---|---|
| `↑` `↓` | 이동 |
| `→` `←` | 펼치기, 접기 |
| `Enter` | 그 space, tab, pane으로 이동 |
| 글자 입력 | 필터 (띄어 쓰면 AND) |
| `Esc` | 닫기 |

### 확인창

| 키 | 동작 |
|---|---|
| `←` `→` | Cancel, Confirm 선택 |
| `Enter` | 선택한 쪽 실행 (처음엔 Confirm) |
| `y` | 닫기 |
| `n` `Esc` | 취소 |

## 화면

설치하면 `main-gap0` 레이아웃으로 바뀝니다.

- pane 사이 간격 없음
- 사이드바에 space와 에이전트를 한 목록으로 표시
- space 줄 끝의 화살표로 그 space의 에이전트 접기
- 줌 상태에서 pane 위에 빨간 ZOOM 배지 표시
- 테마 tomorrow-night, 글꼴 Jetendard 11

원래 화면으로 돌아가려면 `Cmd+Shift+l`로 레이아웃을 바꾸면 됩니다. 기본 `main` 레이아웃은 그대로 남아 있습니다.

## 세팅을 고칠 때

`home/` 아래 파일을 고치고 스크립트를 다시 실행합니다.

`~/.config/herdr-app`의 파일을 직접 고치면 다음 실행 때 저장소 내용으로 덮어씁니다. 덮어쓰기 전 파일은 `~/.config/herdr-app/.sashin92-herder-backup/`에 남습니다.

## 되돌리기

1. `Cmd+Shift+l`로 `main` 레이아웃으로 전환
2. `~/.config/herdr-app/keys.json`에서 위 표의 키 삭제, tab 닫기 키는 `tab.close`로 복원
3. `layouts/main-gap0.json`과 `mods/` 아래 이 저장소의 폴더 삭제

화면이 꼬여서 아무것도 안 될 때는 `Ctrl+Alt+Shift+Esc`를 누르면 Herdr가 기본 화면으로 돌려놓습니다.

## 주의

- macOS에서만 사용해 봄. Linux는 임시 폴더에서 스크립트만 확인, Windows는 실행해 본 적 없음
- Windows에서 설정 폴더를 못 찾으면 `-AppHome <폴더>`로 지정
- Herdr 버전이 다르면 일부 mod가 안 맞을 수 있음 (스크립트가 `!`로 표시)

## 라이선스

`spaces-agents`, `pane-picker`, `confirm-choice`, `main-gap0` 레이아웃은 Herdr 기본 mod와 레이아웃을 고친 것입니다. Herdr는 Apache 2.0이고 전문은 `LICENSE-Apache-2.0`에 있습니다.
