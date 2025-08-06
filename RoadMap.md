### 1.Project Overview

**Application Name:**
Autonomys Governance Bot

**Core Idea:**
This is a Discord bot integrated with the Autonomys blockchain, designed to conduct anonymous and secure voting with full automation - from initiating votes to reading results from Auto-drive — a reliable decentralized and distributed file storage.

**Problem Addressed:**
The bot eliminates manual labor and human error in the voting process within Discord communities: it automates thread creation and formatting, participant eligibility verification, tracking of progress and deadlines, and securely stores results in a transparent blockchain infrastructure.
It solves instability and vulnerability inherent in manual processes, such as forgetting formats or rules, roles changing, lack of tagging problems.
We gain the flexibility to adapt quickly to changes in policy or mechanics (e.g. voting deadlines, roles) by adjusting variables within the bot.


### 2.Current Status

 ✔️ Support for slash commands necessary for creating discussions, proposals, votes, token issuance, and result queries;
 ✔️ Automated thread formatting and deadline enforcement;
 ✔️ Generation of unique VoteTokens for each participant;
 ✔️ Voting interface and progress display integrated in Discord threads;
 ✔️ Eligibility control based on Discord roles;
 ✔️ Automatic thread locking upon voting expiry;
 ✔️ Crash resilience: the bot restores its state using only the data stored in thread messages;
 ✔️ Uploading voting results to Auto-drive;
 ✔️ Retrieving voting results.

**Key Open Tasks and Issues Required Further Work:**

* 📌 **Unified Data Source (Registry):**
  Currently participant rights are managed via `.env` file. We aim to replace this with a robust on-chain registry as the authoritative source of rights and other parameters for voting eligibility. This registry currently exists as a Google Sheet containing ambassadors Discord handles, IDs, emails, statuses, status changes dates, primary/secondary team assignments, etc. Our goal is to fully migrate this to the blockchain for transparency, immutability, and up-to-date data.
  Ideally the Governance team needs a smart contract that can be the starting point for AmbOS (ambassador operational system) on chain - it would start with the registry and move it out of google sheet to be on chain.

* 📌 **Architectural Decision for State Management (Crash Resilience):**
  I am still deciding whether to:
    — implement a **local state store** (e.g., SQLite or FileDB) to increase reliability, which demands significantly more code, syncing layers, and redundancy;
    — or further refine and rigorously test my existing concept - **using Discord as the source of truth**, where all data (tokens, vote statuses, etc.) is read from thread messages. This approach has proven extremely effective in practice: simple, easily recoverable, and nearly elegant, but requires more testing for edge cases (failovers, archiving, renamed threads, malicious behavior, etc.).

* 📌 **On-chain Data Recording Strategy:**
  Another task to resolve: whether to record **every action** (or at least each vote button press) as a separate on-chain transaction, or only **the aggregated final result** upon vote completion or deadline, or HW failures. The former offers greater transparency and logging; the latter is more efficient in terms of time and wallet balance.

* 📌 **Handling Secondary Roles and Multy-Team Membership:**
  We need to define how to treat users with **secondary Governance roles** - those for whom Governance is not the primary team. While legal definitions are not finalized, we lean toward including them in votes, but not in all cases. By the way, given recent membership changes and evolving voting regulation, a flexible bot configuration - capable of adapting via variables - is especially valuable. 

* 📌 **Privacy and Encryption:**
  For the on-chain registry, we must decide which data fields are public and which are private. Sensitive information (e.g. email) may require **encryption** and access via public keys. This work is in progress.

* 📌 **Substrate ↔ EVM Bridge:**
  We need to build a module that allows the bot’s balance to be funded from **EVM wallet addresses**. Currently, funding is possible only through Substrate accounts. This is of course essential for production use.

* 📌 **Interface Enhancements:**
  The Discord interface can still be improved.

### 3.Project Goals

To build a fully adaptive, resilient Discord voting bot integrated with Autonomys infrastructure. The bot should deliver:

* Secure, anonymous voting;
* Decentralized storage of results;
* Independence from manual administration and any local configuration files;
* Strong resilience to failures and seamless state recovery;
* Transparent voting mechanics for the Governance team and (may be) other units;
* Flexibility to quickly adjust to changing voting rules.

**Short-Term Goals:**

* Determine the primary configuration source (likely Registry);
* Define which registry fields will be encrypted.
* Introduce encryption for private registry fields. Monitor Autonomys SDK capabilities. If there are no solutions - develop it;
* Deploy the on-chain registry in production as the sole authority for voting rights and use the bot as the exclusive voting tool;
* Develop smart contract that can be the starting point for ambos on the blockchain;
* Implement a Substrate‑EVM bridge to fund the bot’s wallet from EVM addresses;
* Thoroughly test edge cases in current architecture (archiving, restarts, renaming, malicious inputs and behaviour);
* Expose as many configurable variables as possible for maximum flexibility.
* Adapt to complex rule changes, for ex. such as users belonging to multiple primary teams.
* Build an advanced governance interface: settings, audit logs, support for multiple roles and other.
* Enable scalability - allow other DAO mini-teams to use the bot in their own channels;

