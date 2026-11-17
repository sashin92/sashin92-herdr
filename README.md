# sashin92-herder

[Herdr](https://herdr.dev) 데스크톱 앱에 쓰는 개인 설정이다. tmux에서 쓰던 `Option`(Alt) 단축키와, 그걸 위해 만든 mod, 간격 없는 레이아웃이 들어 있다. 설치 스크립트를 실행하면 어느 컴퓨터에서든 같은 환경이 된다.

기준 버전은 herdr-app 0.1.16, herdr-core(`hc`) 0.1.21이다.

## 설치

Herdr를 설치하고 한 번 실행해 둔다(설정 폴더가 만들어져야 한다). 그다음 이 저장소를 받아 운영체제에 맞는 스크립트를 실행한다. Herdr가 켜져 있는 상태에서 실행하면 한 번에 끝난다.

```sh
git clone https://github.com/sashin92/sashin92-herder.git
cd sashin92-herder
```

| 운영체제 | 명령 | 필요한 것 |
|---|---|---|
| macOS | `./install-macos.sh` | `python3` |
| Linux | `./install-linux.sh` | `python3` |
| Windows | `powershell -ExecutionPolicy Bypass -File .\install-windows.ps1` | PowerShell 5.1 이상 |

옵션은 세 스크립트가 같다.

| macOS, Linux | Windows | 뜻 |
|---|---|---|
| `--dry-run` | `-DryRun` | 바꾸지 않고 무엇이 바뀔지만 보여준다 |
| `--no-app` | `-NoApp` | 파일, 단축키, 설정만 넣고 실행 중인 앱은 건드리지 않는다 |
| `--home <폴더>` | `-AppHome <폴더>` | Herdr 설정 폴더가 기본 위치가 아닐 때 |

Herdr 설정 폴더는 `HERDR_APP_HOME` 환경 변수, 없으면 `~/.config/herdr-app`에서 찾는다.

### 여러 번 실행해도 된다

스크립트는 단계마다 지금 상태를 먼저 보고 다른 것만 바꾼다. 이미 맞춰져 있으면 `Nothing to change.`만 나온다. 저장소를 `git pull`로 갱신한 뒤 다시 실행하면 바뀐 부분만 반영된다.

- 덮어쓰는 파일은 먼저 `<설정 폴더>/.sashin92-herder-backup/<시각>/`에 보관한다.
- Herdr가 꺼져 있으면 파일, 단축키, 설정까지만 넣고 끝난다. Herdr를 켜고 한 번 더 실행하면 나머지가 마무리된다.

## 스크립트가 하는 일

| 단계 | 내용 |
|---|---|
| 파일 | `home/mods`, `home/layouts`, `home/themes`의 파일을 설정 폴더에 복사한다. 없거나 내용이 다른 파일만 복사한다. |
| 단축키 | `home/keys.json`의 키를 설정 폴더의 `keys.json`에 합친다. 원래 있던 다른 키는 그대로 둔다. tab을 닫는 키(운영체제마다 다름)는 확인창을 거치도록 바꾼다. 여기서 정한 키가 `terminal` 구역에 있으면 지운다(그 구역이 `global`보다 우선해서 가려지기 때문). |
| 설정 | `home/settings.json`의 값을 설정 폴더의 `settings.json`에 합친다. `option_as_alt`는 macOS에서만 넣는다. |
| 앱 | Herdr가 켜져 있으면 각 mod를 `herdr-app check`로 검사하고, 항상 떠 있어야 하는 mod 두 개(`zoom-badge`, `agent-jump`)를 `main`과 `main-gap0` 레이아웃에 등록하고, 테마를 `tomorrow-night`으로 고르고, `main-gap0` 레이아웃을 띄운다. |

스크립트가 하지 않는 것은 이렇다.

- 글꼴 설치. `settings.json`이 Jetendard를 지정하므로 따로 설치해야 한다. 없으면 Herdr 기본 글꼴로 나온다.
- 원격 머신 등록. 새 컴퓨터에서 `hc machine add`로 다시 등록한다.
- 사이드바 폭처럼 화면에서 끌어서 정한 값.

## 단축키

macOS에서는 왼쪽 `Option`이 Alt다.

| 키 | 동작 |
|---|---|
| `Alt+h/j/k/l` | pane 이동 |
| `Alt+Shift+h/j/k/l` | 초점 pane 크기 조정 (tmux `resize-pane`과 같은 규칙, 한 번에 3%) |
| `Alt+1`~`9` | space 이동 |
| `Alt+[`, `Alt+]` | 이전, 다음 space |
| `Ctrl+1`~`9` | 사이드바 순서로 N번째 에이전트로 이동 |
| `Alt+s` | 전체 목록과 미리보기 |
| `Alt+z` | pane 줌 |
| `Alt+w` | 확인 후 pane 닫기 |
| tab 닫기 키 (macOS `Cmd+w`) | 확인 후 tab 닫기 |

확인창에서는 `←` `→`로 고르고 `Enter`로 실행한다. `y`는 바로 닫기, `n`과 `Esc`는 취소다.

## 들어 있는 것

| 위치 | 내용 |
|---|---|
| `home/mods/pane-picker` | 컴퓨터 > space > tab > pane 목록. `→`로 펼치고 `←`로 접는다. 옆에 고른 pane의 화면, 또는 tab의 pane들을 실제 분할 배치대로 보여준다. |
| `home/mods/pane-resize-left`, `-down`, `-up`, `-right` | 방향별 크기 조정. `resize.js`는 네 폴더가 같은 파일이다(mod는 다른 mod 폴더의 파일을 불러올 수 없다). 고칠 때는 네 곳을 같이 고친다. |
| `home/mods/zoom-badge` | 줌 상태일 때 빨간 ZOOM 배지 |
| `home/mods/confirm-choice`, `confirm-close-pane`, `confirm-close-tab` | 방향키로 고르는 확인창과, 닫기 키를 그 확인창에 잇는 mod |
| `home/mods/agent-jump` | `Ctrl+숫자`로 N번째 에이전트로 이동 |
| `home/mods/spaces-agents` | Spaces 목록과 Agents 목록을 하나로 합친 사이드바 |
| `home/layouts/main-gap0.json` | 기본 `main` 레이아웃에서 pane 사이 간격과 바깥 여백을 없애고, 사이드바를 `spaces-agents` 하나로 바꾼 레이아웃 |
| `home/themes/tomorrow-night.json` | 어두운 테마 |
| `home/keys.json` | 추가하는 단축키 |
| `home/settings.json` | 글꼴, 글자 크기 등 |

## 설정을 고칠 때

저장소가 기준이다. 설정 폴더의 mod 파일을 직접 고친 뒤 스크립트를 실행하면 저장소 내용으로 덮어쓴다(덮어쓰기 전 파일은 백업 폴더에 남는다). 고친 내용을 유지하려면 `home/` 아래 파일에 반영하고 커밋한다.

레이아웃을 바꿔 가며 보려면 `Cmd+Shift+l`(macOS)을 누른다. 원래 `main` 레이아웃은 그대로 남아 있다.

## 제거

1. `keys.json`에서 `home/keys.json`에 있는 키를 지우고, tab 닫기 키를 `tab.close`로 되돌린다.
2. ZOOM 배지와 에이전트 이동 mod를 닫는다: `herdr-app do mod.open --name zoom-badge`, `herdr-app do mod.open --name agent-jump` (레이아웃마다 한 번씩).
3. `main` 레이아웃으로 바꾼 뒤 `layouts/main-gap0.json`과 `mods/` 아래 해당 폴더들을 지운다.

화면이 이상해져 조작이 안 되면 `Ctrl+Alt+Shift+Esc`를 누른다. Herdr가 현재 레이아웃과 `keys.json`을 옆으로 치우고 기본 화면으로 돌아간다.

## 확인 상태

| 환경 | 상태 |
|---|---|
| macOS | 실제 설정 폴더에 설치하고 두 번째 실행에서 변경이 없는 것을 확인했다. mod는 이 환경에서 만들고 써 본 것이다. |
| Linux | 스크립트의 파일 복사, 단축키 합치기, 설정 합치기를 임시 폴더에서 확인했다. 실제 Linux의 Herdr에서는 실행해 보지 않았다. |
| Windows | 스크립트와 mod의 Windows 분기 모두 실행해 보지 못했다. 설정 폴더 위치는 `%USERPROFILE%\.config\herdr-app`, `%APPDATA%\herdr-app`, `%LOCALAPPDATA%\herdr-app` 순서로 찾으며, 다르면 `-AppHome`으로 지정한다. |

Herdr 버전이 기준 버전과 다르면 기본 mod를 고쳐 만든 것(`spaces-agents`, `pane-picker`, `confirm-choice`)이 다르게 보이거나 검사에서 걸릴 수 있다. 스크립트는 검사에 걸린 mod를 `!`로 알려준다.

## 출처와 라이선스

아래 mod는 Herdr에 들어 있는 기본 mod를 고쳐 만든 것이다. Herdr는 Apache License 2.0으로 배포되며, 그 전문을 `LICENSE-Apache-2.0`에 넣어 두었다.

| mod | 바탕이 된 Herdr 기본 mod |
|---|---|
| `spaces-agents` | `spaces`, `agents` |
| `pane-picker` | `picker` |
| `confirm-choice` | `confirm` |

`home/layouts/main-gap0.json`은 Herdr의 `main` 레이아웃을 복제해 고친 것이다.
