import { NextRequest, NextResponse } from "next/server";
import { getRewardSettings, saveRewardSettings } from "@/lib/rewardStore";
import {
  canExecuteCafe24RewardChanges,
  getRewardExecutionMode,
  isCafe24RewardIntegrationConfigured,
} from "@/lib/rewardExecution";
import { getCafe24OAuthStatus } from "@/lib/cafe24OAuth";
import {
  updateCafe24CustomerGroupAutoUpdateSettings,
  updateCafe24CustomerGroupName,
} from "@/lib/cafe24Admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const oauth = getCafe24OAuthStatus();
  return NextResponse.json({
    settings: getRewardSettings(),
    integrationReady: isCafe24RewardIntegrationConfigured(),
    oauth,
    executionMode: getRewardExecutionMode(),
    executionAllowed: canExecuteCafe24RewardChanges(),
    nativeRewardsDisabled: process.env.CAFE24_NATIVE_REWARDS_DISABLED === "true",
  });
}
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "올바른 설정값이 필요합니다." }, { status: 400 });
  }

  const before = getRewardSettings();
  const settings = saveRewardSettings(body);
  const updatedGroupNames: string[] = [];
  const pendingGroupNames: string[] = [];
  const oauth = getCafe24OAuthStatus();
  let autoUpdatePolicySynced = false;

  if (oauth.connected) {
    try {
      await updateCafe24CustomerGroupAutoUpdateSettings({
        issueTrigger: settings.issueTrigger,
        deductCancellationRefund: settings.grades.some((grade) => grade.recoveryMode === "automatic"),
      });
      autoUpdatePolicySynced = true;
    } catch (error) {
      console.error("[reward settings] customer group auto-update sync failed", {
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  for (const grade of settings.grades) {
    const previous = before.grades.find((item) => item.id === grade.id);
    if (!previous || previous.name === grade.name) continue;
    if (!grade.cafe24GroupNo || !oauth.connected) {
      pendingGroupNames.push(grade.name);
      continue;
    }
    try {
      await updateCafe24CustomerGroupName(grade.cafe24GroupNo, grade.name);
      updatedGroupNames.push(grade.name);
    } catch (error) {
      pendingGroupNames.push(grade.name);
      console.error("[reward settings] customer group name sync failed", {
        groupNo: grade.cafe24GroupNo,
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  return NextResponse.json({
    ok: true,
    settings,
    integrationReady: isCafe24RewardIntegrationConfigured(),
    oauth,
    executionMode: getRewardExecutionMode(),
    executionAllowed: canExecuteCafe24RewardChanges(),
    nativeRewardsDisabled: process.env.CAFE24_NATIVE_REWARDS_DISABLED === "true",
    groupNameSync: { updated: updatedGroupNames, pending: pendingGroupNames },
    cafe24AutoUpdateSync: { updated: autoUpdatePolicySynced, pending: oauth.connected && !autoUpdatePolicySynced },
  });
}
