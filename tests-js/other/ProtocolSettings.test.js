const { expectRevert, BN } = require("@openzeppelin/test-helpers");
const { ZERO_ADDRESS } = require("@openzeppelin/test-helpers/src/constants");
const { expect } = require("chai");
const MultiSigWallet = artifacts.require("MultiSigWallet");

const ProtocolSettings = artifacts.require("ProtocolSettings");
const TestToken = artifacts.require("TestToken");

const { getSUSD, getRBTC, getWRBTC, getBZRX, getPriceFeeds, decodeLogs, getSovryn } = require("../Utils/initializer.js");

const wei = web3.utils.toWei;

const oneEth = new BN(wei("1", "ether"));
const hunEth = new BN(wei("100", "ether"));

// Deploys the multisig wallet contract setting 3 owners and 2 required confirmations

const getMultisig = async (accounts) => {
	const requiredConf = 2;
	const owners = [accounts[0], accounts[1], accounts[2]];
	const multisig = await MultiSigWallet.new(owners, requiredConf);
	return multisig;
};

contract("ProtocolSettings", (accounts) => {
	let sovryn, SUSD, WRBTC, RBTC, BZRX, priceFeeds, multisig;
	const ONE_ADDRESS = "0x0000000000000000000000000000000000000001";
	beforeEach(async () => {
		SUSD = await getSUSD();
		RBTC = await getRBTC();
		WRBTC = await getWRBTC();
		BZRX = await getBZRX();
		priceFeeds = await getPriceFeeds(WRBTC, SUSD, RBTC, sovryn, BZRX);
		sovryn = await getSovryn(WRBTC, SUSD, RBTC, priceFeeds);

		multisig = await getMultisig(accounts);
		await sovryn.transferOwnership(multisig.address);
	});

	describe("ProtocolSettings Tests", () => {
		it("Test setCoreParams", async () => {
			const dest = sovryn.address;
			const val = 0;

			let data = sovryn.contract.methods.setPriceFeedContract(ONE_ADDRESS).encodeABI();
			let tx = await multisig.submitTransaction(dest, val, data, { from: accounts[0] });
			let txId = tx.logs.filter((item) => item.event == "Submission")[0].args["transactionId"];
			await multisig.confirmTransaction(txId, { from: accounts[1] });

			data = sovryn.contract.methods.setSwapsImplContract(ONE_ADDRESS).encodeABI();
			tx = await multisig.submitTransaction(dest, val, data, { from: accounts[0] });
			txId = tx.logs.filter((item) => item.event == "Submission")[0].args["transactionId"];
			await multisig.confirmTransaction(txId, { from: accounts[1] });

			expect((await sovryn.priceFeeds()) == ONE_ADDRESS).to.be.true;
			expect((await sovryn.swapsImpl()) == ONE_ADDRESS).to.be.true;
		});

		it("Test setLoanPool", async () => {
			expect((await sovryn.loanPoolToUnderlying(accounts[6])) == ZERO_ADDRESS).to.be.true;
			expect((await sovryn.underlyingToLoanPool(accounts[7])) == ZERO_ADDRESS).to.be.true;

			expect(await sovryn.isLoanPool(accounts[6])).to.be.false;
			expect(await sovryn.isLoanPool(accounts[8])).to.be.false;
			const dest = sovryn.address;
			let val = 0;
			let data = sovryn.contract.methods.setLoanPool([accounts[6], accounts[8]], [accounts[7], accounts[9]]).encodeABI();
			let tx = await multisig.submitTransaction(dest, val, data, { from: accounts[0] });
			let txId = tx.logs.filter((item) => item.event == "Submission")[0].args["transactionId"];
			await multisig.confirmTransaction(txId, { from: accounts[1] });

			expect((await sovryn.loanPoolToUnderlying(accounts[6])) == accounts[7]).to.be.true;
			expect((await sovryn.underlyingToLoanPool(accounts[7])) == accounts[6]).to.be.true;

			expect((await sovryn.loanPoolToUnderlying(accounts[8])) == accounts[9]).to.be.true;
			expect((await sovryn.underlyingToLoanPool(accounts[9])) == accounts[8]).to.be.true;

			expect(await sovryn.isLoanPool(accounts[6])).to.be.true;
			expect(await sovryn.isLoanPool(accounts[8])).to.be.true;

			data = sovryn.contract.methods.setLoanPool([accounts[6]], [ZERO_ADDRESS]).encodeABI();
			tx = await multisig.submitTransaction(dest, val, data, { from: accounts[0] });
			txId = tx.logs.filter((item) => item.event == "Submission")[0].args["transactionId"];
			await multisig.confirmTransaction(txId, { from: accounts[1] });

			expect((await sovryn.loanPoolToUnderlying(accounts[6])) == ZERO_ADDRESS).to.be.true;
			expect((await sovryn.underlyingToLoanPool(accounts[7])) == ZERO_ADDRESS).to.be.true;

			expect(await sovryn.isLoanPool(accounts[6])).to.be.false;
		});

		it("Test set wrbtc token", async () => {
			expect((await sovryn.owner()) == multisig.address).to.be.true;

			const dest = sovryn.address;
			const val = 0;
			const data = sovryn.contract.methods.setWrbtcToken(WRBTC.address).encodeABI();
			const tx = await multisig.submitTransaction(dest, val, data, { from: accounts[0] });
			const txId = tx.logs.filter((item) => item.event == "Submission")[0].args["transactionId"];
			await multisig.confirmTransaction(txId, { from: accounts[1] });

			expect((await sovryn.wrbtcToken()) == WRBTC.address).to.be.true;

			await expectRevert(sovryn.setWrbtcToken(WRBTC.address, { from: accounts[0] }), "unauthorized");
		});

		it("Test set protocol token address", async () => {
			expect((await sovryn.protocolTokenAddress()) == ZERO_ADDRESS).to.be.true;

			const dest = sovryn.address;
			const val = 0;
			const data = sovryn.contract.methods.setProtocolTokenAddress(sovryn.address).encodeABI();
			const tx = await multisig.submitTransaction(dest, val, data, { from: accounts[0] });
			const txId = tx.logs.filter((item) => item.event == "Submission")[0].args["transactionId"];
			await multisig.confirmTransaction(txId, { from: accounts[1] });

			expect((await sovryn.protocolTokenAddress()) == sovryn.address).to.be.true;

			await expectRevert(sovryn.setProtocolTokenAddress(sovryn.address, { from: accounts[1] }), "unauthorized");
		});

		/*
			Should set and deposit the protocol token
			1. deploy erc20
			2. set address
			3. approve token transfer
			4. deposit tokens
			5. verify balance
		*/
		it("Test deposit protocol token", async () => {
			const dest = sovryn.address;
			const val = 0;

			const sov = await TestToken.new("Sovryn", "SOV", 18, new BN(10).pow(new BN(50)));
			await sov.transfer(multisig.address, new BN(10).pow(new BN(50)), { from: accounts[0] });

			let data = await sov.contract.methods.approve(sovryn.address, hunEth).encodeABI();

			let tx = await multisig.submitTransaction(sov.address, val, data, { from: accounts[0] });
			let txId = tx.logs.filter((item) => item.event == "Submission")[0].args["transactionId"];
			await multisig.confirmTransaction(txId, { from: accounts[1] });

			data = await sovryn.contract.methods.setProtocolTokenAddress(sov.address).encodeABI();

			tx = await multisig.submitTransaction(dest, val, data, { from: accounts[0] });
			txId = tx.logs.filter((item) => item.event == "Submission")[0].args["transactionId"];
			await multisig.confirmTransaction(txId, { from: accounts[1] });

			data = sovryn.contract.methods.depositProtocolToken(hunEth).encodeABI();

			tx = await multisig.submitTransaction(dest, val, data, { from: accounts[0] });
			txId = tx.logs.filter((item) => item.event == "Submission")[0].args["transactionId"];
			await multisig.confirmTransaction(txId, { from: accounts[1] });

			expect((await sovryn.protocolTokenHeld()).eq(hunEth)).to.be.true;
		});

		it("Test fail deposit protocol token", async () => {
			const dest = sovryn.address;
			const val = 0;

			const sov = await TestToken.new("Sovryn", "SOV", 18, new BN(10).pow(new BN(50)));
			await sov.transfer(multisig.address, new BN(10).pow(new BN(50)), { from: accounts[0] });

			let data = await sov.contract.methods.approve(sovryn.address, hunEth).encodeABI();

			let tx = await multisig.submitTransaction(sov.address, val, data, { from: accounts[0] });
			let txId = tx.logs.filter((item) => item.event == "Submission")[0].args["transactionId"];
			await multisig.confirmTransaction(txId, { from: accounts[1] });

			data = await sovryn.contract.methods.setProtocolTokenAddress(sov.address).encodeABI();

			tx = await multisig.submitTransaction(dest, val, data, { from: accounts[0] });
			txId = tx.logs.filter((item) => item.event == "Submission")[0].args["transactionId"];
			await multisig.confirmTransaction(txId, { from: accounts[1] });

			await expectRevert(sovryn.depositProtocolToken(sov.address, { from: accounts[0] }), "unauthorized");
		});

		// Should successfully withdraw all deposited protocol tokens
		it("Test withdraw protocol token", async () => {
			const dest = sovryn.address;
			const val = 0;

			const sov = await TestToken.new("Sovryn", "SOV", 18, new BN(10).pow(new BN(50)));
			await sov.transfer(multisig.address, new BN(10).pow(new BN(50)), { from: accounts[0] });

			let data = await sov.contract.methods.approve(sovryn.address, hunEth).encodeABI();

			let tx = await multisig.submitTransaction(sov.address, val, data, { from: accounts[0] });
			let txId = tx.logs.filter((item) => item.event == "Submission")[0].args["transactionId"];
			await multisig.confirmTransaction(txId, { from: accounts[1] });

			data = await sovryn.contract.methods.setProtocolTokenAddress(sov.address).encodeABI();

			tx = await multisig.submitTransaction(dest, val, data, { from: accounts[0] });
			txId = tx.logs.filter((item) => item.event == "Submission")[0].args["transactionId"];
			await multisig.confirmTransaction(txId, { from: accounts[1] });

			data = sovryn.contract.methods.depositProtocolToken(hunEth).encodeABI();

			tx = await multisig.submitTransaction(dest, val, data, { from: accounts[0] });
			txId = tx.logs.filter((item) => item.event == "Submission")[0].args["transactionId"];
			await multisig.confirmTransaction(txId, { from: accounts[1] });

			const balanceBefore = await sov.balanceOf(accounts[1]);

			data = sovryn.contract.methods.withdrawProtocolToken(accounts[1], hunEth).encodeABI();

			tx = await multisig.submitTransaction(dest, val, data, { from: accounts[0] });
			txId = tx.logs.filter((item) => item.event == "Submission")[0].args["transactionId"];
			await multisig.confirmTransaction(txId, { from: accounts[1] });

			const balanceAfter = await sov.balanceOf(accounts[1]);
			expect((await sovryn.protocolTokenHeld()).eq(new BN(0))).to.be.true;
			expect(balanceAfter.eq(balanceBefore.add(hunEth))).to.be.true;
		});

		// Should fail to withdraw 1e30 protocol tokens but withdraw 1e20
		it("Test fail withdraw protocol token", async () => {
			const dest = sovryn.address;
			const val = 0;

			const sov = await TestToken.new("Sovryn", "SOV", 18, new BN(10).pow(new BN(50)));
			await sov.transfer(multisig.address, new BN(10).pow(new BN(50)), { from: accounts[0] });

			let data = await sov.contract.methods.approve(sovryn.address, hunEth).encodeABI();

			let tx = await multisig.submitTransaction(sov.address, val, data, { from: accounts[0] });
			let txId = tx.logs.filter((item) => item.event == "Submission")[0].args["transactionId"];
			await multisig.confirmTransaction(txId, { from: accounts[1] });

			data = await sovryn.contract.methods.setProtocolTokenAddress(sov.address).encodeABI();

			tx = await multisig.submitTransaction(dest, val, data, { from: accounts[0] });
			txId = tx.logs.filter((item) => item.event == "Submission")[0].args["transactionId"];
			await multisig.confirmTransaction(txId, { from: accounts[1] });

			data = sovryn.contract.methods.depositProtocolToken(hunEth).encodeABI();

			tx = await multisig.submitTransaction(dest, val, data, { from: accounts[0] });
			txId = tx.logs.filter((item) => item.event == "Submission")[0].args["transactionId"];
			await multisig.confirmTransaction(txId, { from: accounts[1] });

			const balanceBefore = await sov.balanceOf(accounts[1]);

			data = sovryn.contract.methods.withdrawProtocolToken(accounts[1], new BN(10).pow(new BN(30))).encodeABI();

			tx = await multisig.submitTransaction(dest, val, data, { from: accounts[0] });
			txId = tx.logs.filter((item) => item.event == "Submission")[0].args["transactionId"];
			await multisig.confirmTransaction(txId, { from: accounts[1] });

			const balanceAfter = await sov.balanceOf(accounts[1]);
			expect((await sovryn.protocolTokenHeld()).eq(new BN(0))).to.be.true;
			expect(balanceAfter.eq(balanceBefore.add(hunEth))).to.be.true;
		});

		// Should successfully change rollover base reward
		it("Test set rollover base reward", async () => {
			const new_reward = new BN(10).pow(new BN(15));
			const old_reward = await sovryn.rolloverBaseReward();

			const dest = sovryn.address;
			const val = 0;
			const data = await sovryn.contract.methods.setRolloverBaseReward(new_reward).encodeABI();

			const tx = await multisig.submitTransaction(dest, val, data, { from: accounts[0] });
			let txId = tx.logs.filter((item) => item.event == "Submission")[0].args["transactionId"];
			const { receipt } = await multisig.confirmTransaction(txId, { from: accounts[1] });

			const decode = decodeLogs(receipt.rawLogs, ProtocolSettings, "SetRolloverBaseReward");
			const event = decode[0].args;
			expect(event["sender"] == multisig.address).to.be.true;
			expect(event["oldValue"] == old_reward.toString()).to.be.true;
			expect(event["newValue"] == new_reward.toString()).to.be.true;
			expect((await sovryn.rolloverBaseReward()).eq(new_reward)).to.be.true;
		});

		// Should fail to change rollover base reward by unauthorized user
		it("Test set rollover base reward by unauthorized user", async () => {
			await expectRevert(sovryn.setRolloverBaseReward(new BN(10).pow(new BN(15)), { from: accounts[0] }), "unauthorized");
		});

		// Should successfully change rebate percent
		it("Test set rebate percent", async () => {
			const new_percent = new BN(2).mul(oneEth);
			const old_percent = await sovryn.getFeeRebatePercent();

			const dest = sovryn.address;
			const val = 0;
			const data = await sovryn.contract.methods.setRebatePercent(new_percent).encodeABI();

			const tx = await multisig.submitTransaction(dest, val, data, { from: accounts[0] });
			let txId = tx.logs.filter((item) => item.event == "Submission")[0].args["transactionId"];
			const { receipt } = await multisig.confirmTransaction(txId, { from: accounts[1] });

			const decode = decodeLogs(receipt.rawLogs, ProtocolSettings, "SetRebatePercent");
			const event = decode[0].args;
			expect(event["sender"] == multisig.address).to.be.true;
			expect(event["oldRebatePercent"] == old_percent.toString()).to.be.true;
			expect(event["newRebatePercent"] == new_percent.toString()).to.be.true;
			expect((await sovryn.getFeeRebatePercent()).eq(new_percent)).to.be.true;
		});

		// Should fail to change rebate percent by unauthorized user
		it("Test set rebate percent by unauthorized user", async () => {
			await expectRevert(sovryn.setRebatePercent(new BN(2).mul(oneEth), { from: accounts[0] }), "unauthorized");
		});
	});
});
