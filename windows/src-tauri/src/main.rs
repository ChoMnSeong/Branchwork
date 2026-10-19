// 릴리스 빌드에서 Windows 콘솔 창이 뜨지 않게
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // git 의 자격 증명 질문(GIT_ASKPASS)이나 Claude Code 훅으로 불린 경우: 창을 띄우지 않고 답만 하고 끝낸다
    if branchwork_lib::helper::handle_cli() {
        return;
    }
    branchwork_lib::run()
}
