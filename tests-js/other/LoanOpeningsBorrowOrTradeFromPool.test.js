const { expect } = require("chai");
const { constants, BN } = require("@openzeppelin/test-helpers");
const LoanSettingsEvents = artifacts.require("LoanSettingsEvents");
const LoanOpeningsEvents = artifacts.require("LoanOpeningsEvents");

const { getSUSD, getRBTC, getWRBTC, getBZRX, getPriceFeeds, getSovryn, getSOV, decodeLogs } = require("../Utils/initializer.js");

const wei = web3.utils.toWei;

const oneEth = new BN(wei("1", "ether"));
const hunEth = new BN(wei("100", "ether"));

contract("LoanOpeningsBorrowOrTradeFromPool", (accounts) => {
	let sovryn, SUSD, WRBTC, RBTC, BZRX, priceFeeds;

	beforeEach(async () => {
		SUSD = await getSUSD();
		RBTC = await getRBTC();
		WRBTC = await getWRBTC();
		BZRX = await getBZRX();
		priceFeeds = await getPriceFeeds(WRBTC, SUSD, RBTC, sovryn, BZRX);

		sovryn = await getSovryn(WRBTC, SUSD, RBTC, priceFeeds);
		sov = await getSOV(sovryn, priceFeeds, SUSD, accounts);
	});

	const LinkDaiMarginParamsId = async () => {
		const loanParams = {
			id: constants.ZERO_BYTES32,
			active: false,
			owner: constants.ZERO_ADDRESS,
			loanToken: SUSD.address,
			collateralToken: RBTC.address,
			minInitialMargin: new BN(20).mul(oneEth),
			maintenanceMargin: new BN(15).mul(oneEth),
			fixedLoanTerm: "2419200", // 28 days
		};
		const { receipt } = await sovryn.setupLoanParams([Object.values(loanParams)]);
		const decode = decodeLogs(receipt.rawLogs, LoanSettingsEvents, "LoanParamsIdSetup");
		return decode[0].args["id"];
	};

	const LinkDaiBorrowParamsId = async () => {
		const loanParams = {
			id: constants.ZERO_BYTES32,
			active: false,
			owner: constants.ZERO_ADDRESS,
			loanToken: SUSD.address,
			collateralToken: RBTC.address,
			minInitialMargin: new BN(20).mul(oneEth),
			maintenanceMargin: new BN(15).mul(oneEth),
			fixedLoanTerm: "0", // torque loan
		};
		const { receipt } = await sovryn.setupLoanParams([Object.values(loanParams)]);
		const decode = decodeLogs(receipt.rawLogs, LoanSettingsEvents, "LoanParamsIdSetup");
		return decode[0].args["id"];
	};

	describe("Tests loan opening isolated. does not work together with the other tests. needs to be run separately.", () => {
		/*
			At this moment the maxLoanTerm is always 28 because it is hardcoded in setupLoanParams.
			So there are only fix-term loans.
		*/
		it("Test marginTradeFromPool sim", async () => {
			// setup simulated loan pool
			await sovryn.setLoanPool([accounts[1]], [accounts[2]]);

			const sovrynBeforeSUSDBalance = await SUSD.balanceOf(sovryn.address);
			console.log("sovrynBeforeSUSDBalance", sovrynBeforeSUSDBalance.toString());

			const sovrynBeforeRBTCBalance = await RBTC.balanceOf(sovryn.address);
			console.log("sovrynBeforeRBTCBalance", sovrynBeforeRBTCBalance.toString());

			const loanTokenSent = hunEth;

			await SUSD.mint(sovryn.address, loanTokenSent, { from: accounts[0] });

			const sovrynSwap = await sovryn.sovrynSwapContractRegistryAddress();
			// console.log('sovryn seap contract registry address is ',sovrynSwap)
			// addressOf = sovrynSwap.addressOf(sovrynSwap.address)
			console.log("returned address is ", sovrynSwap);
			const swapsI = await sovryn.swapsImpl();
			console.log("swaps impl is ", swapsI);
			const collateralTokenSent = await sovryn.getRequiredCollateral(
				SUSD.address,
				RBTC.address,
				loanTokenSent,
				new BN(50).mul(oneEth),
				false
			);
			console.log("required collateral:", collateralTokenSent.div(oneEth).toString());

			await RBTC.mint(sovryn.address, collateralTokenSent, { from: accounts[0] });

			console.log("loanTokenSent", loanTokenSent.toString());
			console.log("collateralTokenSent", collateralTokenSent.toString());

			const tx = await sovryn.borrowOrTradeFromPool(
				await LinkDaiMarginParamsId(), //loanParamsId
				"0x0", // loanId
				false, // isTorqueLoan,
				hunEth, // initialMargin
				[
					accounts[2], // lender
					accounts[1], // borrower
					accounts[1], // receiver
					constants.ZERO_ADDRESS, // manager
				],
				[
					new BN(5).mul(oneEth), // newRate (5%)
					loanTokenSent, // newPrincipal
					0, // torqueInterest
					loanTokenSent, // loanTokenSent
					collateralTokenSent, // collateralTokenSent
				],
				"0x", // loanDataBytes
				{ from: accounts[1] }
			);

			const sovrynAfterSUSDBalance = await SUSD.balanceOf(sovryn.address);
			console.log("sovrynAfterSUSDBalance", sovrynAfterSUSDBalance.toString());

			const sovrynAfterRBTCBalance = await RBTC.balanceOf(sovryn.address);
			console.log("sovrynAfterRBTCBalance", sovrynAfterRBTCBalance.toString());

			const decode = decodeLogs(tx.receipt.rawLogs, LoanOpeningsEvents, "Trade");
			const tradeEvent = decode[0].args;

			const interestForPosition = loanTokenSent
				.mul(new BN(5).mul(oneEth))
				.div(hunEth)
				.div(new BN(365))
				.mul(new BN(2419200))
				.div(new BN(86400));
			console.log("interestForPosition", interestForPosition.toString());

			// expectedPositionSize = collateralTokenSent + ((loanTokenSent - interestForPosition) * tradeEvent["entryPrice"] // 1e18)
			const expectedPositionSize = loanTokenSent
				.sub(interestForPosition)
				.mul(new BN(tradeEvent["entryPrice"]))
				.div(oneEth)
				.add(collateralTokenSent);

			// ignore differences in least significant digits due to rounding error
			expect(Math.abs(expectedPositionSize.sub(new BN(tradeEvent["positionSize"])).toNumber()) < 100).to.be.true;
		});

		it("Test borrowFromPool sim", async () => {
			// setup simulated loan pool
			await sovryn.setLoanPool([accounts[1]], [accounts[2]]);

			const sovrynBeforeSUSDBalance = await SUSD.balanceOf(sovryn.address);
			console.log("sovrynBeforeSUSDBalance", sovrynBeforeSUSDBalance.toString());

			const sovrynBeforeRBTCBalance = await RBTC.balanceOf(sovryn.address);
			console.log("sovrynBeforeRBTCBalance", sovrynBeforeRBTCBalance.toString());

			const loanTokenSent = oneEth;
			const newPrincipal = new BN(101).mul(oneEth);

			await SUSD.mint(sovryn.address, loanTokenSent, { from: accounts[0] });
			const collateralTokenSent = await sovryn.getRequiredCollateral(
				SUSD.address,
				RBTC.address,
				newPrincipal,
				new BN(50).mul(oneEth),
				true
			);

			await RBTC.mint(sovryn.address, collateralTokenSent, { from: accounts[0] });

			console.log("loanTokenSent", loanTokenSent.toString());
			console.log("collateralTokenSent", collateralTokenSent.toString());

			const tx = await sovryn.borrowOrTradeFromPool(
				await LinkDaiBorrowParamsId(), //loanParamsId
				"0x0", // loanId
				true, // isTorqueLoan,
				new BN(50).mul(oneEth), // initialMargin
				[
					accounts[2], // lender
					accounts[1], // borrower
					accounts[1], // receiver
					constants.ZERO_ADDRESS, // manager
				],
				[
					new BN(5).mul(oneEth), // newRate (5%)
					newPrincipal, // newPrincipal
					oneEth, // torqueInterest
					loanTokenSent, // loanTokenSent
					collateralTokenSent, // collateralTokenSent
				],
				"0x", // loanDataBytes
				{ from: accounts[1] }
			);
			// TODO: add expected and actual result comparison or else the borrow test is without validation
			const sovrynAfterSUSDBalance = await SUSD.balanceOf(sovryn.address);
			console.log("sovrynAfterSUSDBalance", sovrynAfterSUSDBalance.toString());

			const sovrynAfterRBTCBalance = await RBTC.balanceOf(sovryn.address);
			console.log("sovrynAfterRBTCBalance", sovrynAfterRBTCBalance.toString());

			const decode = decodeLogs(tx.receipt.rawLogs, LoanOpeningsEvents, "Borrow");
			const borrowEvent = decode[0].args;
			console.log(borrowEvent);
		});
	});
});
