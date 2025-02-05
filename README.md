## What this bot is



This is a Discord Governance Bot for the Autonomys blockchain that enables:

    🗳️ Anonymous voting using cryptographically generated tokens (VoteTokens) to protect voter identity

    📜 Thread-based governance with automated creation of discussions, proposals, and voting threads

    ⏱️ Time-bound voting with auto-locking threads after expiration (7 days by default)

    🔗 Blockchain integration to immutably store voting results on Autonomys Auto-drive

    🔄 Self-healing functionality that recovers voting state after bot downtime

    🛡️ Tamper-proof design with thread name enforcement and vote token validation

    ☀️ The key innovation is using the thread's own messages as the source of truth,
       allowing the bot to rebuild its state completely from Discord's API after any downtime.



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

> **Update**: ⚠️The code just updated. The voting results are now correctly being recorded to Auto-drive and retrieved from by the `/result` command.

The simple version (where results are saved in consensus layer) is moved to votebot-simple directory.


## Below is detailed description of the bot functioning



**Bot's Slash Commands**:

`/discussion <subject>`	- creates a Discussion thread with name in format: "D:[subject]".

`/proposal <subject>`	- creates a Proposal thread with name in format: "P:YYYY-MM-DD: [subject]",
        where `YYYY-MM-DD` is the expiration date, when the thread will be self-locked, 7 days from the creation date, by default.
        The [subject] is to be entered manually by user.

`/vote <subject>`		- creates a thread with name in format: "V:YYYY-MM-DD: [subject]",
        where `YYYY-MM-DD` is the expiration date, when the thread will be self-locked, this is managed by variable VOTING_DURATION in `.env` file.
        The [subject] is to be entered manually by user.
> **Note:** 
> For testing purposes it could be set to 1 hour.

> Users will not be able to change voting thread name - to prevent this the bot will roll-back the thread's name every time, when a user tries to rename it.

> The bot will control tries to re-activate expired threads, and lock them back immediately.

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
 - EVM_ENDPOINT=...		//
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
> **Note:**
> The bot generates a hash based on userID, threadID and a secret. This is a 8 symbols string. This function returns constant within one threadID and for one userID. So VoteToken is always the same for the same user and thread.


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

> **Note:**
> To prevent repeated voting the bot accepts votes only from those users, whose VoteTokens are listed in the 'Progress message' in the thread.

> After each new vote the counter should be adjusted and so that the number of votes is always displayed in the thread, making this no problem, if bot goes offline without any local databases. When bot come up again - it just read all data from the thread.

> Bot doesn't send a bc transaction every time someone votes. Only the completed voting process results are to be sent to the blockchain once all participants have voted, or at the moment of the thread expiration.

**Timers**

Upon expiration date, day 7, the bot does:
 - lock the thread, so that it will be available only for reading only (and prevent to reactivate it manually, closing again, if anyone will try to restore it),
 - create blockchain transaction.

**Bot has Gone Offline?**

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


**Wallet**
To execute blockchain transactions, the bot's wallet needs to be funded.
There is function for swapping tokens from EVM address to Substrate (bridging.js)
It uses variablees in .env file:
WALLET_EVM_ADDR="0x32F533Db704398F5d819A2E28bA0Bba15445E1D0"              //to be funded with faucet
SIGNER_SUBSTRATE_ADDR="5GEstkiRc5H7GYS6NQYnxdKQQG4jYWQ9rZ1q2xqsYtbN8x36"  //signer

> **Note**
In current realization to pay fees you have to have Substrate balance, even to use `bridging.js`.
If we need EVM sign (secp256k1) the code should be modified to use `ethers`



Detailed Files Explanation

bot.ts

    Initialization:
        When the bot is ready, it reads the offline timestamp, registers commands, initializes the Substrate connection using initChain, and initializes the Auto-drive API using initDrive. Then it calls checkActiveThreads() to process any expired threads.

    Thread Processing (checkActiveThreads):
        For every active text channel in all guilds, the bot fetches active threads.
        For threads whose names start with "P:" or "V:" (proposal or voting threads) and which are not locked, archived, or already finalized, it checks if the thread is expired.
        If expired, the bot sends a message indicating that voting is completed, stores the final voting results on Auto-drive via storeVotingResultsOnChain (which returns a CID), sends a message with the CID, marks the thread as finalized, and locks the thread.

    Slash Commands:
        /discussion: Creates a discussion thread.
        /proposal: Creates a proposal thread with an expiration date.
        /vote: Creates a voting thread with buttons for voting. It sends an initial message with vote tokens and progress information.
        /myvotetoken: Returns the vote token for the user in the current thread.
        /results: This command is intended to be invoked from the main channel. It finds the specified thread by ID or name. If the thread is not locked (i.e. voting is still in progress), it replies with a warning. Otherwise, it fetches the messages from the thread to extract a CID (from a message that contains "CID:"), then retrieves final results from Auto-drive using retrieveVotingResults and displays them.
        /help: Lists available commands.

    Button Interaction Handler:
        When a vote button is pressed, the bot verifies eligibility by checking if the user's token is still present.
        It updates the vote counts in the progress message.
        If the final vote is cast (voting is finished), it stores the final results on Auto-drive (retrieving a CID) and sends a message in the thread with the CID. Then it locks the thread to prevent further interactions.

    Utility Functions:
        createThread: Creates a new thread in the current channel.
        findThreadByRef: Finds a thread by its ID or name (searching active and archived threads).
        findProgressMessage: Finds the bot’s progress message in a thread.
        getRoleMembers: Returns a collection of guild members having a specific role.



blockchain.ts

    Module Purpose:
	This module integrates with a Substrate node and Auto-drive to handle the storage and retrieval of final voting results. The results are stored as a JSON file on Auto-drive (an IPFS-like storage system).

    VotingResultsPayload Interface:
	Defines the shape of the voting results object, including thread ID, creation date, full thread name, eligible participant count, votes summary, and status flags.

    initChain Function:
	Connects to the Substrate node using the provided RPC endpoint and seed phrase. It creates a KeyringPair used to sign transactions.

    initDrive Function:
	Initializes the Auto-drive API using the API key (DRIVE_APIKEY) from the environment and setting the network to "taurus". This API instance is used for file upload/download operations.

    storeVotingResultsOnChain Function:
	Converts the VotingResultsPayload to JSON, wraps it in a GenericFile object (with properties name, size, and a read method that returns an async iterable), and uploads it to Auto-drive. It returns the CID (Content Identifier) for the stored file.

    retrieveVotingResults Function:
	Downloads the file from Auto-drive using its CID, concatenates the received Buffer chunks, converts the result to a UTF-8 string, and parses the JSON to reconstruct the VotingResultsPayload object.


utils.ts

    File Overview:
    This utility module contains common functions used by the Discord bot. These functions include generating a vote token, formatting dates for thread expiration, checking if a thread is expired, determining if the voting is finished, marking threads as finalized (to prevent duplicate result submissions), locking threads, and storing/reading an offline timestamp.

    generateVoteToken:
    This function concatenates a user ID, thread ID, and a secret (from environment variables) to form a base string, computes a simple hash from it, and converts the result into an 8-character hexadecimal token. This token is used to uniquely identify a user's eligibility to vote in a specific thread.

    formatExpirationDate:
    Given the current date and a number of hours to add (representing the voting duration), this function returns a formatted date string (YYYY-MM-DD) which is used when constructing thread names.

    isExpiredThread:
    This function checks whether the current time is after the thread's creation time plus the voting duration. It uses the dayjs library for date manipulation.

    isVotingFinished:
    Voting is considered finished if the total number of votes meets or exceeds the total number of eligible participants or if the voting time has expired.

    markThreadFinalized / isThreadFinalized:
    These functions maintain a set of thread IDs for which final results have been submitted, ensuring that final results are not stored more than once.

    lockThread:
    This function locks and archives a thread, preventing further interactions. If an error occurs during locking (for example, due to insufficient permissions), it is silently ignored.

    storeOfflineTimestamp / readOfflineTimestamp:
    These functions write and read a timestamp to/from a file. This can be used to track how long the bot was offline.
