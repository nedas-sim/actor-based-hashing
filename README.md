# actor-based-hashing

Program hashes data and does that by distributing work to actors with different roles.

4 roles:

- Distributor - gets messages and sends them accordingly to other actors.
- Result collector (res) - gets objects and saves them in an array.
- Printer - at the very end, prints the data to file.
- Worker - hashes object data and sends it to distributor.

Program runs with command: node index.js

Input and output file names are put in the index.js file.
