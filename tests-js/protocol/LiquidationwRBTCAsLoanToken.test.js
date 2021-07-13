const { BN } = require("@openzeppelin/test-helpers");
const FeesEvents = artifacts.require("FeesEvents");

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
	getSOV,
} = require("../Utils/initializer.js");

const { liquidate, liquidate_healthy_position_should_fail } = require("./liquidationFunctions");

/*
Should test the liquidation handling
1. Liquidate a position
2. Should fail to liquidate a healthy position
*/

contract("ProtocolLiquidationTestToken", (accounts) => {
	let owner;
	let sovryn, SUSD, WRBTC, RBTC, BZRX, loanToken, loanTokenWRBTC, priceFeeds, SOV;

	before(async () => {
		[owner] = accounts;
	});

	beforeEach(async () => {
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
		SOV = await getSOV(sovryn, priceFeeds, SUSD, accounts);
	});

	describe("Tests liquidation handling ", () => {
		/*
			Test with different rates so the currentMargin is <= liquidationIncentivePercent
			or > liquidationIncentivePercent
			liquidationIncentivePercent = 5e18 by default
		*/
		it("Test liquidate", async () => {
			const rate = new BN(10).pow(new BN(23));
			await liquidate(accounts, loanTokenWRBTC, WRBTC, set_demand_curve, SUSD, sovryn, priceFeeds, rate, WRBTC, FeesEvents, SOV);
		});

		it("Test liquidate", async () => {
			const rate = new BN(134).mul(new BN(10).pow(new BN(20)));
			await liquidate(accounts, loanTokenWRBTC, WRBTC, set_demand_curve, SUSD, sovryn, priceFeeds, rate, WRBTC, FeesEvents, SOV);
		});

		/*
			Test if fails when the position is healthy currentMargin > maintenanceRate
		*/
		it("Test liquidate healthy position should fail", async () => {
			await liquidate_healthy_position_should_fail(
				accounts,
				loanTokenWRBTC,
				WRBTC,
				set_demand_curve,
				SUSD,
				sovryn,
				priceFeeds,
				WRBTC
			);
		});
	});
});
