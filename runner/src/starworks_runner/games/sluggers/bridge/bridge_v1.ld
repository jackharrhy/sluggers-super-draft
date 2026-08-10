OUTPUT_FORMAT("elf32-powerpc")
OUTPUT_ARCH(powerpc)
ENTRY(StarworksMainLoopHook)

StarworksOriginalMainLoopCall = 0x8050B2E4;

SECTIONS
{
  . = 0x80002A00;
  .text : ALIGN(4)
  {
    KEEP(*(.text.starworks_trampoline))
    *(.text .text.*)
  }
  /DISCARD/ :
  {
    *(.comment)
    *(.eh_frame)
    *(.llvm_addrsig)
  }
}
