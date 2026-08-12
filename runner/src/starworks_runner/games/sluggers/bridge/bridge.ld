OUTPUT_FORMAT("elf32-powerpc")
OUTPUT_ARCH(powerpc)
ENTRY(StarworksMainLoopHook)

StarworksOriginalMainLoopCall = 0x8050B2E4;
  StarworksTeamSelectionContinue = 0x8006AED8;
  StarworksCpuControlContinue = 0x80063D50;

SECTIONS
{
  . = 0x80002700;
  .text : ALIGN(4)
  {
    KEEP(*(.text.starworks_trampoline))
    *(.text .text.*)
    *(.rodata .rodata.*)
  }
  /DISCARD/ :
  {
    *(.comment)
    *(.eh_frame)
    *(.llvm_addrsig)
  }
}
