const { assert, expect } = require("chai");

const { BN, constants, balance, expectEvent, expectRevert } = require("@openzeppelin/test-helpers");

const sovrynProtocol = artifacts.require("sovrynProtocol");
const ProtocolSettings = artifacts.require("ProtocolSettings");
const LoanSettings = artifacts.require("LoanSettings");
const LoanMaintenance = artifacts.require("LoanMaintenance");
const LoanOpenings = artifacts.require("LoanOpenings");
const SwapsExternal = artifacts.require("SwapsExternal");
const LoanClosingsBase = artifacts.require("LoanClosingsBase");
const LoanClosingsWith = artifacts.require("LoanClosingsWith");
const Affiliates = artifacts.require("Affiliates");

const ISovryn = artifacts.require("ISovryn");
const TestToken = artifacts.require("TestToken");
const LockedSOV = artifacts.require("LockedSOVMockup");
const MockLoanTokenLogic = artifacts.require("MockLoanTokenLogic");
const TestWrbtc = artifacts.require("TestWrbtc");
const SOVToken = artifacts.require("SOV");
const LoanToken = artifacts.require("LoanToken");
const LoanOpeningsEvents = artifacts.require("LoanOpeningsEvents");

const TOTAL_SUPPLY = "10000000000000000000000000";
const wei = web3.utils.toWei;
const oneEth = new BN(wei("1", "ether"));
const hunEth = new BN(wei("100", "ether"));
const { increaseTime, blockNumber } = require("./Utils/Ethereum");

const {
	getSUSD,
	getRBTC,
	getWRBTC,
	getBZRX,
	getLoanTokenLogic,
	getLoanToken,
	getLoanTokenLogicWrbtc,
	getLoanTokenWRBTC,
	loan_pool_setup,
	set_demand_curve,
	getPriceFeeds,
	getSovryn,
	decodeLogs,
	getSOV,
	verify_sov_reward_payment,
} = require("./Utils/initializer.js");

contract("Pause Modules", (accounts) => {
	let sovryn, SUSD, WRBTC, RBTC, BZRX, loanToken, loanTokenWRBTC, priceFeeds, SOV;
	let loanParams, loanParamsId;

	before(async () => {
		[owner, trader, referrer, account1, account2, ...accounts] = accounts;
		const sovrynproxy = await sovrynProtocol.new();
		sovryn = await ISovryn.at(sovrynproxy.address);
		await sovryn.replaceContract((await LoanClosingsBase.new()).address);
		await sovryn.replaceContract((await LoanClosingsWith.new()).address);
		await sovryn.replaceContract((await ProtocolSettings.new()).address);
		await sovryn.replaceContract((await LoanSettings.new()).address);
		await sovryn.replaceContract((await LoanMaintenance.new()).address);
		await sovryn.replaceContract((await SwapsExternal.new()).address);
		await sovryn.replaceContract((await LoanOpenings.new()).address);
		await sovryn.replaceContract((await Affiliates.new()).address);
		await sovryn.setSovrynProtocolAddress(sovrynproxy.address);
		SUSD = await getSUSD();
		RBTC = await getRBTC();
		WRBTC = await getWRBTC();
		BZRX = await getBZRX();
		priceFeeds = await getPriceFeeds(WRBTC, SUSD, RBTC, sovryn, BZRX);
		sovryn = await getSovryn(WRBTC, SUSD, RBTC, priceFeeds);

		const loanTokenLogicStandard = await getLoanTokenLogic();
		const loanTokenLogicWrbtc = await getLoanTokenLogicWrbtc();
		loanToken = await getLoanToken(loanTokenLogicStandard, owner, sovryn, WRBTC, SUSD);
		loanTokenWRBTC = await getLoanTokenWRBTC(loanTokenLogicWrbtc, owner, sovryn, WRBTC, SUSD);
		await loan_pool_setup(sovryn, owner, RBTC, WRBTC, SUSD, loanToken, loanTokenWRBTC);
		SOV = await getSOV(sovryn, priceFeeds, SUSD);

		//Token
		underlyingToken = await TestToken.new("Test token", "TST", 18, TOTAL_SUPPLY);

		loanParams = {
			id: "0x0000000000000000000000000000000000000000000000000000000000000000",
			active: false,
			owner: constants.ZERO_ADDRESS,
			loanToken: underlyingToken.address,
			collateralToken: loanTokenWRBTC.address,
			minInitialMargin: wei("50", "ether"),
			maintenanceMargin: wei("15", "ether"),
			maxLoanTerm: "2419200",
		};
	});

	const setup_rollover_test = async (RBTC, SUSD, accounts, loanToken, set_demand_curve, sovryn) => {
		await set_demand_curve(loanToken);
		await SUSD.approve(loanToken.address, new BN(10).pow(new BN(40)));
		const lender = accounts[0];
		const borrower = accounts[1];
		let tx = await sovryn.togglePaused(false); //Unpaused
		await expectEvent(tx, "TogglePaused", {
			sender: owner,
			oldFlag: true,
			newFlag: false,
		});
		await loanToken.mint(lender, new BN(10).pow(new BN(30)));
		const loan_token_sent = hunEth;
		await SUSD.mint(borrower, loan_token_sent);
		await SUSD.approve(loanToken.address, loan_token_sent, { from: borrower });
		const { receipt } = await loanToken.marginTrade(
			"0x0", // loanId  (0 for new loans)
			new BN(2).mul(oneEth), // leverageAmount
			loan_token_sent, // loanTokenSent
			0, // no collateral token sent
			RBTC.address, // collateralTokenAddress
			borrower, // trader,
			"0x", // loanDataBytes (only required with ether)
			{ from: borrower }
		);

		const decode = decodeLogs(receipt.rawLogs, LoanOpeningsEvents, "Trade");
		const loan_id = decode[0].args["loanId"];
		const loan = await sovryn.getLoan(loan_id);
		const num = await blockNumber();
		let currentBlock = await web3.eth.getBlock(num);
		const block_timestamp = currentBlock.timestamp;
		const time_until_loan_end = loan["endTimestamp"] - block_timestamp;
		await increaseTime(time_until_loan_end);
		return [borrower, loan, loan_id, parseInt(loan["endTimestamp"])];
	};

	describe("Pause Affiliates", () => {
		it("Should pause setting Affiliates referrer", async () => {
			loanTokenLogic = await MockLoanTokenLogic.new();
			testWrbtc = await TestWrbtc.new();
			doc = await TestToken.new("dollar on chain", "DOC", 18, wei("20000", "ether"));
			tokenSOV = await SOVToken.new(TOTAL_SUPPLY);
			loanTokenV1 = await LoanToken.new(owner, loanTokenLogic.address, sovryn.address, testWrbtc.address);
			await loanTokenV1.initialize(doc.address, "SUSD", "SUSD");
			loanTokenV2 = await MockLoanTokenLogic.at(loanTokenV1.address);
			const loanTokenAddress = await loanTokenV1.loanTokenAddress();
			if (owner == (await sovryn.owner())) {
				await sovryn.setLoanPool([loanTokenV2.address], [loanTokenAddress]);
			}
			let tx = await sovryn.togglePaused(true); //Paused
			await expectEvent(tx, "TogglePaused", {
				sender: owner,
				oldFlag: false,
				newFlag: true,
			});
			await expectRevert(loanTokenV2.setAffiliatesReferrer(trader, referrer), "Paused");
		});
	});

	describe("Pause LoanClosingBase", () => {
		it("Test rollover reward payment", async () => {
			// prepare the test
			const [, initial_loan, loan_id] = await setup_rollover_test(RBTC, SUSD, accounts, loanToken, set_demand_curve, sovryn);

			const num = await blockNumber();
			let currentBlock = await web3.eth.getBlock(num);
			const block_timestamp = currentBlock.timestamp;
			const time_until_loan_end = initial_loan["endTimestamp"] - block_timestamp;
			await increaseTime(time_until_loan_end);

			const receiver = accounts[3];
			expect((await RBTC.balanceOf(receiver)).toNumber() == 0).to.be.true;
			let tx = await sovryn.togglePaused(true); //Paused
			await expectEvent(tx, "TogglePaused", {
				sender: owner,
				oldFlag: false,
				newFlag: true,
			});
			await expectRevert(sovryn.rollover(loan_id, "0x", { from: receiver }), "Paused");
		});
	});

	describe("Pause ProtocolSettings", () => {
		it("Should pause setting SOV token address", async () => {
			const sov = await TestToken.new("Sovryn", "SOV", 18, new BN(10).pow(new BN(50)));
			await expectRevert(sovryn.setSOVTokenAddress(sov.address), "Paused");
		});

		it("Should pause setting LockedSOV token address", async () => {
			const sov = await TestToken.new("Sovryn", "SOV", 18, new BN(10).pow(new BN(50)));
			const lockedSOV = await LockedSOV.new(sov.address, [accounts[0]]);
			await expectRevert(sovryn.setLockedSOVAddress(lockedSOV.address), "Paused");
		});

		it("Should pause setting affiliate fee percent", async () => {
			const affiliateFeePercent = web3.utils.toWei("20", "ether");
			await expectRevert(sovryn.setAffiliateFeePercent(affiliateFeePercent), "Paused");
		});

		it("Should pause setting affiliate fee percent", async () => {
			const affiliateTradingTokenFeePercent = web3.utils.toWei("20", "ether");
			await expectRevert(sovryn.setAffiliateTradingTokenFeePercent(affiliateTradingTokenFeePercent), "Paused");
		});

		it("Should set affiliate fee percent when Unpaused", async () => {
			let tx = await sovryn.togglePaused(false); //Unpaused
			await expectEvent(tx, "TogglePaused", {
				sender: owner,
				oldFlag: true,
				newFlag: false,
			});
			const affiliateTradingTokenFeePercent = web3.utils.toWei("20", "ether");
			const invalidAffiliateTradingTokenFeePercent = web3.utils.toWei("101", "ether");
			// Should revert if set with non owner
			await expectRevert(
				sovryn.setAffiliateTradingTokenFeePercent(affiliateTradingTokenFeePercent, { from: accounts[1] }),
				"unauthorized"
			);
			// Should revert if value too high
			await expectRevert(sovryn.setAffiliateTradingTokenFeePercent(invalidAffiliateTradingTokenFeePercent), "value too high");

			await sovryn.setAffiliateTradingTokenFeePercent(affiliateTradingTokenFeePercent);
			expect((await sovryn.affiliateTradingTokenFeePercent()).toString() == affiliateTradingTokenFeePercent).to.be.true;
		});
	});
	describe("Pause LoanSettings", () => {
		it("Able to setupLoanParams & disableLoanParamsEvents when unpaused", async () => {
			let tx = await sovryn.setupLoanParams([Object.values(loanParams)]);
			loanParamsId = tx.logs[1].args.id;

			tx = await sovryn.disableLoanParams([loanParamsId], { from: owner });

			await expectEvent(tx, "LoanParamsIdDisabled", { owner: owner });
			assert(tx.logs[1]["id"] != "0x0");

			await expectEvent(tx, "LoanParamsDisabled", {
				owner: owner,
				loanToken: underlyingToken.address,
				collateralToken: loanTokenWRBTC.address,
				minInitialMargin: wei("50", "ether"),
				maintenanceMargin: wei("15", "ether"),
				maxLoanTerm: "2419200",
			});
			assert(tx.logs[0]["id"] != "0x0");
		});

		it("setupLoanParams & disableLoanParamsEvents freezes when protocol is paused", async () => {
			let tx = await sovryn.togglePaused(true); //Paused
			await expectEvent(tx, "TogglePaused", {
				sender: owner,
				oldFlag: false,
				newFlag: true,
			});
			await expectRevert(sovryn.setupLoanParams([Object.values(loanParams)]), "Paused");
		});
	});
});
