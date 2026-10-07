/** Props that GameShell passes to every game component. */
export interface GameProps {
	/**
	 * True while the pause or game-over menu is open (including when the tab is hidden).
	 * Games must stop their loop and ignore input while paused.
	 */
	paused: boolean;
	/** Report the current score; the shell shows it in the HUD. */
	onScore: (score: number) => void;
	/** Report that the game has ended. The shell records the high score and shows the game-over menu. */
	onGameOver: (finalScore: number) => void;
}
