const { task } = require("hardhat/config");

require("@nomiclabs/hardhat-ganache");
require("@nomiclabs/hardhat-truffle5");
require("@nomiclabs/hardhat-ethers");
require("@nomiclabs/hardhat-web3");
require("@nomiclabs/hardhat-waffle");
require("hardhat-contract-sizer"); //yarn run hardhat size-contracts
require("solidity-coverage"); // $ npx hardhat coverage
require("hardhat-log-remover");
require('hardhat-docgen');
require("@nomiclabs/hardhat-waffle");

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
/// this is for use with ethers.js
task("accounts", "Prints the list of accounts", async () => {
	const accounts = await ethers.getSigners();

	for (const account of accounts.address) {
		const wallet = ethers.Wallet.fromMnemonic("test test test test test test test test test test test junk", "m/44'/60'/0'/0");

		console.log(account);
	}
});

/*task("accounts", "Prints accounts", async (_, { web3 }) => {
	console.log();
	console.log(await web3.eth.getAccounts());
});*/

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
/**/

module.exports = {
	solidity: {
		version: "0.5.17",
		settings: {
			optimizer: {
				enabled: true,
				runs: 200,
			},
		},
	},
	contractSizer: {
		alphaSort: false,
		runOnCompile: false,
		disambiguatePaths: false,
	},
	networks: {
		hardhat: {},
		rskPublicTestnet: {
			url: "https://public-node.testnet.rsk.co/",
			accounts: { mnemonic: "brownie", count: 10 },
			network_id: 31,
			confirmations: 4,
			gasMultiplier: 1.25,
			//timeout: 20000, // increase if needed; 20000 is the default value
			//allowUnlimitedContractSize, //EIP170 contrtact size restriction temporal testnet workaround
		},
		rskPublicMainnet: {
			url: "https://public-node.rsk.co/",
			network_id: 30,
			//timeout: 20000, // increase if needed; 20000 is the default value
		},
		rskSovrynTestnet: {
			url: "https://testnet.sovryn.app/rpc",
			accounts: { mnemonic: "brownie", count: 10 },
			network_id: 31,
			confirmations: 4,
			gasMultiplier: 1.25,
			//timeout: 20000, // increase if needed; 20000 is the default value
			//allowUnlimitedContractSize, //EIP170 contrtact size restriction temporal testnet workaround
		},
		rskSovrynMainnet: {
			url: "https://mainnet.sovryn.app/rpc",
			network_id: 30,
			//timeout: 20000, // increase if needed; 20000 is the default value
		},
	},
	paths: {
		sources: "./contracts",
		tests: "./tests-js",
	},
	mocha: {
		timeout: 800000,
		grep: "^(?!.*; using Ganache).*",
	},
	docgen: {
		path: './docs',
		clear: true
	}
};
