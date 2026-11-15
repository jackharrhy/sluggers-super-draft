/*
 * Clean-room main-loop trampoline for RMBE01 Rev 0.
 *
 * The guarded patch replaces the reviewed call at 0x8039A688. Calling the
 * bridge first and the original target last preserves the original r3 return
 * value and ABI-visible volatile-register behavior at the hook site.
 */

    .section .text.starworks_trampoline,"ax",@progbits
    .global StarworksMainLoopHook
    .type StarworksMainLoopHook,@function
StarworksMainLoopHook:
    stwu 1, -16(1)
    mflr 0
    stw 0, 20(1)
    bl StarworksBridgeTick
    bl StarworksOriginalMainLoopCall
    lwz 0, 20(1)
    mtlr 0
    addi 1, 1, 16
    blr
    .size StarworksMainLoopHook, . - StarworksMainLoopHook

    .global StarworksTeamSelectionHook
    .type StarworksTeamSelectionHook,@function
StarworksTeamSelectionHook:
    stwu 1, -64(1)
    mflr 0
    stw 0, 8(1)
    mfcr 0
    stw 0, 12(1)
    stw 3, 16(1)
    stw 4, 20(1)
    stw 5, 24(1)
    stw 6, 28(1)
    stw 7, 32(1)
    stw 8, 36(1)
    stw 9, 40(1)
    stw 10, 44(1)
    stw 11, 48(1)
    stw 12, 52(1)
    mr 4, 14
    bl StarworksApplyTeamSelection
    cmpwi 3, 0
    beq StarworksTeamSelectionFallback

StarworksTeamSelectionApplied:
    cmpwi 14, 1
    beq StarworksTeamSelectionAppliedHome
    li 14, 1
    b StarworksTeamSelectionRestore

StarworksTeamSelectionAppliedHome:
    li 14, 0

StarworksTeamSelectionRestore:
    lwz 3, 16(1)
    lwz 4, 20(1)
    lwz 5, 24(1)
    lwz 6, 28(1)
    lwz 7, 32(1)
    lwz 8, 36(1)
    lwz 9, 40(1)
    lwz 10, 44(1)
    lwz 11, 48(1)
    lwz 12, 52(1)
    lwz 0, 12(1)
    mtcr 0
    lwz 0, 8(1)
    mtlr 0
    addi 1, 1, 64
    li 5, 0
    b StarworksTeamSelectionContinue

StarworksTeamSelectionFallback:
    lwz 3, 16(1)
    lwz 4, 20(1)
    lwz 5, 24(1)
    lwz 6, 28(1)
    lwz 7, 32(1)
    lwz 8, 36(1)
    lwz 9, 40(1)
    lwz 10, 44(1)
    lwz 11, 48(1)
    lwz 12, 52(1)
    lwz 0, 12(1)
    mtcr 0
    lwz 0, 8(1)
    mtlr 0
    addi 1, 1, 64
    li 5, 0
    b StarworksTeamSelectionContinue
    .size StarworksTeamSelectionHook, . - StarworksTeamSelectionHook

    .global StarworksCpuControlHook
    .type StarworksCpuControlHook,@function
StarworksCpuControlHook:
    stwu 1, -64(1)
    mflr 0
    stw 0, 8(1)
    mfcr 0
    stw 0, 12(1)
    stw 3, 16(1)
    stw 4, 20(1)
    stw 5, 24(1)
    stw 6, 28(1)
    stw 7, 32(1)
    stw 8, 36(1)
    stw 9, 40(1)
    stw 10, 44(1)
    stw 11, 48(1)
    stw 12, 52(1)
    mr 3, 8
    bl StarworksApplyCpuControl
    lwz 3, 16(1)
    lwz 4, 20(1)
    lwz 5, 24(1)
    lwz 6, 28(1)
    lwz 7, 32(1)
    lwz 8, 36(1)
    lwz 9, 40(1)
    lwz 10, 44(1)
    lwz 11, 48(1)
    lwz 12, 52(1)
    lwz 0, 12(1)
    mtcr 0
    lwz 0, 8(1)
    mtlr 0
    addi 1, 1, 64
    lbz 0, 24(8)
    b StarworksCpuControlContinue
    .size StarworksCpuControlHook, . - StarworksCpuControlHook
