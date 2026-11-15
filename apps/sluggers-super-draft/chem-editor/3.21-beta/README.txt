Made using Python 3.11.11 and Spyder 6.0.4
(No-numpy version can be run via command line with no extra download, but it requires Python 3.12)

Change chem and stats in the first 3 tabs, and then generate the gecko code in the 4th.
Added in version 3.0 : the traj height tab ! You can now change how the trajectories are defined
Added in version 3.1 : various bug fixing, real stamina has been found, as well as star swing/pitch editing
Added in version 3.2 : added the names of various stats, copy gecko code button, and changes to gecko from selection,
		        dev mode and reverse functions to wacky changes

Chemistry tab :
Choose direction and chem type, then pick two characters/groups
For the randomizer, adjust ratios, select options, then press "Randomize each chem"

Stat Editor tab:
Chose a character/group, check the stats to change, select a value, then choose your action

Stat Randomizer tab:
Check stats to change, choose min and max values, as well as range if you select "modify around stats
Add the characters/groups you want to randomize one by one, select options, then press the big red button
Note : Updated displayed stats depend on the min and max for the relevant stat, may lead to weirdness

Gecko Code tab:
Press "Generate entire code". If the code is too big (alert comes up), only generate the relevant characters for the game/team
You can also choose to only generate the code for some characters, while making sure the others are untouched (vanilla stats)
You can save and load the changes made, stored in a .txt file in the program's folder.

Traj Height tab:
Choose a trajectory group to edit, rename it if you want

Wacky stuff tab:
Dev mode allows you to input any number in the double-byte stats.
Reverse buttons reverse the stats according to the current stats (so it will also reverse any change you made).
For reverse stats, it will reverse around the midpoint between the max and min of that stat in vanilla, big outliers excluded)

Credits tab:
Credits where credit is due :)
