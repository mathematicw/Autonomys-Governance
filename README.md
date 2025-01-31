## What this bot is



This is a Discord Governance Bot for the Autonomys blockchain that enables:

    🗳️ Anonymous voting using cryptographically generated tokens (VoteTokens) to protect voter identity

    📜 Thread-based governance with automated creation of discussions, proposals, and voting threads

    ⏳ Time-bound voting with auto-locking threads after expiration (7 days by default)

    🔗 Blockchain integration to immutably store voting results on Autonomys blockchain

    🔄 Self-healing functionality that recovers voting state after bot downtime

    🛡️ Tamper-proof design with thread name enforcement and vote token validation




## **To integrate Autonomys blockchain interaction into a Discord bot, the following SDK components were used:**  

### **For working with transactions:**  
- `@autonomys/auto-consensus`: `transfer.ts` and `remark.ts` modules  
- Utilities from `@autonomys/auto-utils/src/utils/signAndSendTx.ts`  
- Cryptographic functions from `@autonomys/auto-utils/src/crypto.ts`  

### **For connecting to a node:** 
- API helpers from `@autonomys/auto-utils/src/api.ts`  
- Network configurations from `@autonomys/auto-utils/src/constants/network.ts`  

### **Usage examples:**
- Example of sending transactions: `examples/node/src/utils/signAndSend.ts`  
- Example of working with the API: `examples/node/src/utils/setup.ts`





## Below is detailed description of the bot functioning



**Bot's Slash Commands**:

`/discussion <subject>`	- creates a Discussion thread with name in format: "D:[subject]".

`/proposal <subject>`	- creates a Proposal thread with name in format: "P:YYYY-MM-DD: [subject]",
        where `YYYY-MM-DD` is the expiration date, when the thread will be self-locked, 7 days from the creation date, by default.
        The [subject] is to be entered manually by user.

`/vote <subject>`		- creates a thread with name in format: "V:YYYY-MM-DD: [subject]",
        where `YYYY-MM-DD` is the expiration date, when the thread will be self-locked, this is managed by variable VOTING_DURATION in `.env` file.
> ⚠️ **Note:** For testing purposes it could be set to 1 hour.
        The [subject] is to be entered manually by user.

> ⚠️ **Note:** users will not be able to change voting thread name - to prevent this the bot will roll-back the thread's name every time, when a user tries to rename it.
> ⚠️ **Note:** The bot will control tries to re-activate expired threads, and lock them back immediately.

`/myVoteToken`		- bot gets threadID from thread, where the command is ran, and returns VoteToken generated from user's userID, thread's threadID and secret from `.env` file to the user in ephemeral message.

`/results <threadName>` (where threadName is the full name of the thread)
 or
`/results <threadID>`	- retrieves voting data, related to provided name (or ID) of voting thread, from blockchain

`/help`			- shows this commands tutorial (briefly).

`/` 			- shows commands.


**Variables**
`.env` file:

 - DISCORD_TOKEN=...		// Discord Token should be obtained at discord dev portal
 - SUBSTRATE_ENDPOINT=...	// it is "wss://rpc.taurus.subspace.foundation/ws" currently
 - SEED_PHRASE=...		// fund this
 - ROLE_ID=...			// the Discord ID of the role corresponding to the team for which the voting is being conducted
 - VOTERID_SECRET=...  		// this secret is a constant, used for calculating Vote Tokens for each participant
 - VOTING_DURATION=...		// voting thread expiration time (in hours)


**User Creating Threads**

If a user use the command ```/discussion <subject>``` - the bot creates a thread with this name.
If a user use the command ```/proposal <subject>```, the bot mentions the whole team using role ID from `.env`.
If a user use the command ```/vote <subject>```, the bot:
  - gets a threadID for that particular voting thread;
  - look into role, provided in `.env` file (using `role.members`), and get all it's members, including those who are offline at the moment (eligible users);
  - calculate VoteToken for every member of the provided role, deriving it from their Discord userID, threadID and VOTERID_SECRET(from .env);
  - cast a message into the thread with:
	- GUI voting interface: "<FOR> <AGAINST> <ABSTAIN>"
	- the thread's threadID;
	- mention the role, using ROLE_ID from `.env` file to tag all its members at once.
  - casts another message (call it Progress message) with:
	- message or GUI with voting progress under spoiler: "Voting progress: ||<FOR:_> <AGAINST:_> <ABSTAIN:_>|| Warning: Avoid opening the spoiler, make your decision unbiased!".
	- list Voting tokens issued for all eligible users.
> ⚠️ **Note:** the bot generates a hash based on userID, threadID and a secret. This is a 8 symbols string. This function returns constant within one threadID and for one userID. So VoteToken is always the same for the same user and thread.


**User Interaction With the Voting Buttons**

When users interact with the voting buttons the bot follows the algorithm:
    Derive the VoteToken of the user who interacts with vote buttons, look for this VoteToken in the 'Progress message':
	- if there is no such VoteToken in the 'Progress message' - their vote should be ignored, and an ephemeral (visible only to that user) message will be cast: "You are either not eligible or have already used your token!".
	- if there is VoteToken in the 'Progress message' - that means, this is an eligible user, and have not yet cast vote, bot accepts this vote.

**Accepting Voting**

When bot accepts vote it:
	- casts an ephemeral message to the user, containing the VoteToken, corresponded to this user;
	- erases their VoteToken from the 'Progress message' (because this VoteToken can not be used again, preventing repeated voting);
	- adjust vote counter, in accordance with the vote cast. (For ex. if recent user have cast FOR - bot should adjust the "FOR" section of the counter by 1). 
	- when last voter casts vote, the bot returns normal message (not ephemeral) into chat: "Voting successfully completed. The results have been saved to the blockchain. To view, use the command `/results <threadID>`.", locks the thread, send bc transaction.

> ⚠️ **Note:** to prevent repeated voting the bot accepts votes only from those users, whose VoteTokens are listed in the 'Progress message' in the thread.
> ⚠️ **Note:** After each new vote the counter should be adjusted and so that the number of votes is always displayed in the thread, making this no problem, if bot goes offline without any local databases. When bot come up again - it just read all data from the thread.
> ⚠️ **Note:** Bot doesn't send a bc transaction every time someone votes. Only the completed voting process results are to be sent to the blockchain once all participants have voted, or at the moment of the thread expiration.

**Timers**

Upon expiration date, day 7, the bot does:
 - lock the thread, so that it will be available only for reading only (and prevent to reactivate it manually, closing again, if anyone will try to restore it),
 - create blockchain transaction.

**What if Bot has Gone Offline?**

In case the bot has gone offline, upon resurrection it will get the list of active threads in the current channel via Discord API, and check the expiration date of opened threads:
  - If the thread's expiration date has not yet occurred - report about downtime sending normal message to the thread, including exact date-time since and until it was offline: "The bot was offline from ___ to ___. Ready to continue servicing the voting."; 
	- Rebuild vote counters; 
	- Identify remaining eligible users.
	- continue to serve users, interacting with the buttons.
  - If the thread's expiration date passed -that means that the bot was offline at the moment of deadline- it should lock thread, read VoteTokens left in the 'Progress message' and the voting counter's data, and send a blockchain transaction.

**Blockchain Transaction**
When bot needs to send bc transaction , the following data will be included to it:

	- "Voting threadID:"			// ID of the thread
	- "Date of creating the thread:"	// date of thread creating in UTC format
	- "Date of expiring the thread:"	// date when thread was locked in UTC format
	- "Full name of the thread:"		// full thread name
	- "Total role members:"			// get number of all members of the role, specified in `.env` file at that moment
	- "Participants (userID):" 		// get all members of the role, specified in `.env` file at that moment
	- "Voting results:" 			// [FOR] , [AGAINST] , [ABSTAIN] values from voting counter
	- "Voting tokens left:"			// list of VoteTokens which were not used
	- "Deadline missed:"			// the value for true is "Yes" , the value for false is "No".

**Retrieving Voting Results**

The commands:
`/results <threadName>`
or
`/results <threadID>` should return the following information right into the thread, where the command is ran:

	- "Voting threadID:"			// ID of the thread
	- "Date of creating the thread:"	// date of thread creating in UTC format
	- "Date of expiring the thread:"	// date when thread was locked in UTC format
	- "Full name of the thread:"		// full thread name
	- "Total role members:"			// get number of all members of the role, specified in `.env` file at that moment
	- "Participants (userID):" 		// get all members of the role, specified in `.env` file at that moment
	- "Voting results:" 			// [FOR], [AGAINST], [ABSTAIN] values from voting counter
	- "Voting tokens left:"			// list of VoteTokens which were not used
	- "Deadline missed:"			// the value for true is "Yes" , the value for false is "No"


End of description.
