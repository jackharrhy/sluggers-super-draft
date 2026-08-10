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
