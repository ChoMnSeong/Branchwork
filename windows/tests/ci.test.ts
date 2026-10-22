import { describe, expect, it } from "vitest";
import { dispatchInputs, pipelineVariables } from "../src/lib/ci/yaml";
import { githubStatus, gitlabStatus } from "../src/lib/ci/models";

describe("workflow_dispatch 입력값", () => {
  it("입력값(선택·참거짓·여러 줄 설명)을 읽는다", () => {
    const wf = `name: Deploy
on:
  push:
    branches: [ main ]
  workflow_dispatch:
    inputs:
      logLevel:
        description: 'Log level'   # 주석
        required: true
        default: 'warning'
        type: choice
        options:
        - info
        - warning
        - debug
      print_tags:
        description: "True to print: tags"
        required: false
        type: boolean
      env:
        description: |
          Target env
          second line
        type: environment
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run
        run: |
          echo "#hello: x"
`;
    expect(dispatchInputs(wf)).toEqual([
      { name: "logLevel", description: "Log level", required: true, defaultValue: "warning", type: "choice", options: ["info", "warning", "debug"] },
      { name: "print_tags", description: "True to print: tags", required: false, defaultValue: "", type: "boolean", options: [] },
      { name: "env", description: "Target env\nsecond line", required: false, defaultValue: "", type: "environment", options: [] },
    ]);
  });

  it("on 의 여러 형태", () => {
    expect(dispatchInputs("on: [push, workflow_dispatch]\njobs: {}\n")).toEqual([]);
    expect(dispatchInputs('"on": workflow_dispatch\n')).toEqual([]);
    expect(dispatchInputs("on:\n  workflow_dispatch:\n  push:\n")).toEqual([]);
    expect(dispatchInputs("on:\n  push:\n  pull_request:\n")).toBeNull();
    expect(dispatchInputs("on: push\n")).toBeNull();
  });
});

describe("GitLab 파이프라인 변수", () => {
  it("설명이 있는 변수만, 선택지 포함", () => {
    const yml = `variables:
  DEPLOY_ENV:
    value: "staging"
    options:
      - "staging"
      - "production"
    description: "배포 환경"
  PLAIN: "x"
  DRY_RUN:
    value: "false"
    description: Dry run?
stages: [build, deploy]
`;
    expect(pipelineVariables(yml)).toEqual([
      { name: "DEPLOY_ENV", description: "배포 환경", required: false, defaultValue: "staging", type: "choice", options: ["staging", "production"] },
      { name: "DRY_RUN", description: "Dry run?", required: false, defaultValue: "false", type: "string", options: [] },
    ]);
  });
});

describe("상태", () => {
  it("GitLab·GitHub 상태를 하나로", () => {
    expect(gitlabStatus("manual")).toBe("manual");
    expect(gitlabStatus("canceling")).toBe("canceled");
    expect(gitlabStatus("waiting_for_resource")).toBe("waiting");
    expect(githubStatus("completed", "failure")).toBe("failed");
    expect(githubStatus("waiting", null)).toBe("waiting");
    expect(githubStatus("in_progress", null)).toBe("running");
    expect(githubStatus("completed", "action_required")).toBe("manual");
  });
});
